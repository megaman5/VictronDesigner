/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ primary: vi.fn(), backup: vi.fn(), hasKey: vi.fn() }));
vi.mock("../../server/ai/model-client", () => ({
  hasKeyForModel: mocks.hasKey,
  clientForModel: (model: string) => ({ chat: { completions: { create: model.includes("/") ? mocks.backup : mocks.primary } } }),
}));
import { AISession, OPENROUTER_FALLBACK_MODEL, shouldFallback } from "../../server/ai/fallback";
import { estimateCostUsd } from "../../server/ai/pricing";

const body = { model: "gemini-3.8-flash", messages: [{ role: "user" as const, content: "Return JSON" }] };
const completion = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
const outage = (status = 402) => Object.assign(new Error("Provider unavailable"), { status });
const chunk = (content: string) => ({ choices: [{ delta: { content } }] });
async function* chunks() { yield chunk('{"ok":true}'); yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }; }
async function collect(stream: AsyncIterable<any>) { const result = []; for await (const value of stream) result.push(value); return result; }

describe("AI fallback routing", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AI_FALLBACK_ENABLED", "true");
    mocks.hasKey.mockReturnValue(true);
    mocks.primary.mockRejectedValue(outage()); mocks.backup.mockResolvedValue(completion);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("switches once, alerts once, and keeps the backup for subsequent passes", async () => {
    const notify = vi.fn(); const session = new AISession(body.model, notify);
    await session.create(body); await session.create(body);
    expect(mocks.primary).toHaveBeenCalledTimes(1); expect(mocks.backup).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ primaryModel: body.model, model: OPENROUTER_FALLBACK_MODEL, reason: expect.stringContaining("HTTP 402") }));
    expect(session.metadata.modelUsage).toEqual([{ model: OPENROUTER_FALLBACK_MODEL, inputTokens: 20, outputTokens: 10 }]);
  });

  it("uses the tested JSON settings and caps provider pricing at zero", async () => {
    const session = new AISession(body.model);
    await session.create({ ...body, max_completion_tokens: 128_000, messages: [{ role: "user", content: [{ type: "text", text: "Design context" }, { type: "image_url", image_url: { url: "data:image/png;base64,test" } }] }] });
    expect(mocks.backup.mock.calls[0][0]).toMatchObject({
      model: OPENROUTER_FALLBACK_MODEL, response_format: { type: "json_object" }, max_completion_tokens: 32_000,
      reasoning: { enabled: false }, provider: { max_price: { prompt: 0, completion: 0 } },
      messages: [{ content: [{ type: "text", text: "Design context" }] }],
    });
    expect(mocks.backup.mock.calls[0][1]).toMatchObject({ maxRetries: 0, signal: expect.any(AbortSignal) });
  });

  it("keeps a working primary and records usage separately if a later pass fails", async () => {
    mocks.primary.mockResolvedValueOnce(completion);
    const session = new AISession(body.model);
    await session.create(body); expect(mocks.backup).not.toHaveBeenCalled();
    await session.create(body);
    expect(session.metadata.modelUsage).toEqual([
      { model: body.model, inputTokens: 10, outputTokens: 5 },
      { model: OPENROUTER_FALLBACK_MODEL, inputTokens: 10, outputTokens: 5 },
    ]);
    expect(estimateCostUsd(OPENROUTER_FALLBACK_MODEL, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });

  it.each([400, 403, 422])("does not hide an HTTP %i request or policy rejection", async status => {
    mocks.primary.mockRejectedValue(outage(status));
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ status });
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it.each([401, 402, 404, 408, 429, 500, 503])("falls back for provider HTTP %i", async status => {
    mocks.primary.mockRejectedValue(outage(status));
    await new AISession(body.model).create(body); expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("recognizes connection failures and timeouts", () => {
    for (const name of ["APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "TimeoutError", "AbortError"]) expect(shouldFallback({ name })).toBe(true);
  });
  it("preserves both failure reasons and stops when the backup fails", async () => {
    mocks.backup.mockRejectedValue(outage(429));
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ message: expect.stringMatching(/Primary AI failed:.*HTTP 402.*backup also failed/), fallbackExhausted: true, status: 429 });
    expect(mocks.primary).toHaveBeenCalledOnce(); expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("honors the disable setting and unavailable backup credentials", async () => {
    vi.stubEnv("AI_FALLBACK_ENABLED", "false");
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ status: 402 });
    vi.stubEnv("AI_FALLBACK_ENABLED", "true"); mocks.hasKey.mockImplementation(model => !model.includes("/"));
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ status: 402 });
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it("uses the backup if the primary key is missing", async () => {
    mocks.hasKey.mockImplementation(model => model.includes("/"));
    await new AISession(body.model).create(body); expect(mocks.primary).not.toHaveBeenCalled(); expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("falls back on an empty provider response", async () => {
    mocks.primary.mockResolvedValue({ choices: [] });
    await new AISession(body.model).create(body); expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("recovers a stream that fails before content and accounts for its usage", async () => {
    mocks.backup.mockImplementation(() => chunks());
    const session = new AISession(body.model);
    const values = await collect(await session.create({ ...body, stream: true }));
    expect(values[0]).toEqual(chunk('{"ok":true}'));
    expect(session.metadata.modelUsage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(mocks.backup.mock.calls[0][0].stream_options).toEqual({ include_usage: true });
  });
  it("does not mix partial primary JSON with backup JSON and restarts on the sticky backup", async () => {
    mocks.primary.mockImplementation(async function* () { yield chunk('{"partial":'); throw outage(503); });
    mocks.backup.mockImplementation(() => chunks());
    const session = new AISession(body.model); const values: any[] = [];
    await expect((async () => { for await (const value of await session.create({ ...body, stream: true })) values.push(value); })()).rejects.toMatchObject({ retryWithFallback: true });
    expect(values).toEqual([chunk('{"partial":')]); expect(mocks.backup).not.toHaveBeenCalled();
    const clean = await collect(await session.create({ ...body, stream: true }));
    expect(clean[0]).toEqual(chunk('{"ok":true}')); expect(mocks.primary).toHaveBeenCalledOnce();
  });
  it("handles OpenRouter errors embedded in stream chunks", async () => {
    mocks.primary.mockImplementation(async function* () { yield { error: { code: 503, message: "Provider down" } }; });
    mocks.backup.mockImplementation(() => chunks());
    await collect(await new AISession(body.model).create({ ...body, stream: true }));
    expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("rejects fallback output with errors or low scores while leaving primary behavior intact", async () => {
    const session = new AISession(body.model);
    const invalid = { score: 95, issues: [{ severity: "error", message: "Battery disconnected" }] };
    expect(() => session.assertValidFallback(invalid, 70)).not.toThrow();
    await session.create(body);
    expect(() => session.assertValidFallback(invalid, 70)).toThrow("Battery disconnected");
    expect(() => session.assertValidFallback({ score: 69, issues: [] }, 70)).toThrow("Required score: 70");
    expect(() => session.assertValidFallback({ score: 94, issues: [{ severity: "warning", message: "Check capacity" }] }, 70)).not.toThrow();
  });
});
