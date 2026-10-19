/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from "openai";

const mocks = vi.hoisted(() => ({ primary: vi.fn(), backup: vi.fn(), hasKey: vi.fn() }));
vi.mock("../../server/ai/model-client", () => ({
  hasKeyForModel: mocks.hasKey,
  // The backup is the same model asked to think briefly; route on that.
  clientForModel: () => ({ chat: { completions: { create: (body: any, options: any) => (body.reasoning_effort === "low" ? mocks.backup : mocks.primary)(body, options) } } }),
}));
import { AISession, AI_FALLBACK_MODEL, AI_FALLBACK_REASONING_EFFORT, AI_REQUEST_IDLE_TIMEOUT_MS, AI_COMPLETION_TIMEOUT_MS, shouldFallback } from "../../server/ai/fallback";
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
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it("switches once, alerts once, and keeps the backup for subsequent passes", async () => {
    const notify = vi.fn(); const session = new AISession(body.model, notify);
    await session.create(body); await session.create(body);
    expect(mocks.primary).toHaveBeenCalledTimes(1); expect(mocks.backup).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ primaryModel: body.model, model: AI_FALLBACK_MODEL, reason: expect.stringContaining("HTTP 402") }));
    expect(session.metadata.modelUsage).toEqual([{ model: AI_FALLBACK_MODEL, inputTokens: 20, outputTokens: 10 }]);
  });

  it("retries the same model with brief thinking, JSON output and the design picture", async () => {
    const session = new AISession(body.model);
    const content = [{ type: "text" as const, text: "Design context" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,test" } }];
    await session.create({ ...body, max_completion_tokens: 128_000, messages: [{ role: "user", content }] });
    const sent = mocks.backup.mock.calls[0][0];
    expect(sent).toMatchObject({
      model: AI_FALLBACK_MODEL, response_format: { type: "json_object" }, max_completion_tokens: 32_000,
      reasoning_effort: AI_FALLBACK_REASONING_EFFORT, messages: [{ content }],
    });
    // OpenRouter-only fields from the old free backup must not leak through.
    expect(sent).not.toHaveProperty("provider"); expect(sent).not.toHaveProperty("reasoning");
    expect(mocks.backup.mock.calls[0][1]).toMatchObject({ maxRetries: 0, signal: expect.any(AbortSignal) });
  });

  it("keeps a working primary and only switches when a later pass fails", async () => {
    mocks.primary.mockResolvedValueOnce(completion);
    const session = new AISession(body.model);
    await session.create(body); expect(mocks.backup).not.toHaveBeenCalled();
    await session.create(body);
    expect(session.metadata.aiRouting.attempts.map((a: any) => a.settings.reasoningEffort)).toEqual([null, null, AI_FALLBACK_REASONING_EFFORT]);
    expect(session.metadata.modelUsage).toEqual([{ model: AI_FALLBACK_MODEL, inputTokens: 20, outputTokens: 10 }]);
    expect(estimateCostUsd(AI_FALLBACK_MODEL, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeGreaterThan(0);
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
  it.each([
    new APIConnectionError({ message: "Connection lost" }),
    new APIConnectionTimeoutError(),
    new APIUserAbortError(),
  ])("recovers real SDK errors whose name is Error: %s", async error => {
    expect(error.name).toBe("Error");
    mocks.primary.mockRejectedValue(error);
    await new AISession(body.model).create(body);
    expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("recovers an idle timeout before streaming starts", async () => {
    vi.useFakeTimers();
    mocks.primary.mockImplementation((_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new APIUserAbortError()), { once: true });
    }));
    mocks.backup.mockImplementation(() => chunks());
    const session = new AISession(body.model);
    const result = collect(await session.create({ ...body, stream: true }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_IDLE_TIMEOUT_MS);
    expect((await result)[0]).toEqual(chunk('{"ok":true}'));
    expect(session.metadata.aiRouting).toMatchObject({ usedFallback: true, primaryFailure: "AI provider sent no response data for 180 seconds." });
    expect(session.metadata.aiRouting.attempts[0].abortCause).toBe("provider-timeout");
    expect(session.metadata.aiRouting.abortCause).toBeUndefined();
    expect(mocks.backup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a non-streaming provider request and uses the remaining run time for fallback', async () => {
    vi.useFakeTimers();
    mocks.primary.mockImplementation((_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new APIUserAbortError()), { once: true });
    }));
    const result = new AISession(body.model).create(body);
    await vi.advanceTimersByTimeAsync(AI_COMPLETION_TIMEOUT_MS);
    expect(await result).toEqual(completion);
    expect(mocks.backup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never starts fallback after the overall run deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const session = new AISession(body.model); session.signal = controller.signal;
    mocks.primary.mockImplementation((_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new APIUserAbortError()), { once: true });
    }));
    const result = session.create(body).catch(error => error);
    controller.abort(Object.assign(new Error('Run deadline reached'), { abortCause: 'run-deadline', status: 504 }));
    expect(await result).toMatchObject({ abortCause: 'run-deadline', status: 504, message: 'Run deadline reached' });
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps a stream alive beyond both old limits while data keeps arriving", async () => {
    vi.useFakeTimers();
    mocks.primary.mockImplementation(async (_body, { signal }) => {
      await new Promise(resolve => setTimeout(resolve, 60_000));
      return (async function* () {
        for (let i = 0; i < 5; i++) {
          expect(signal.aborted).toBe(false);
          yield chunk(i === 0 ? '{' : ' ');
          await new Promise(resolve => setTimeout(resolve, 60_000));
        }
        yield chunk('}');
      })();
    });
    const result = collect(await new AISession(body.model).create({ ...body, stream: true }));
    await vi.advanceTimersByTimeAsync(360_000);
    expect(await result).toHaveLength(6);
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("detects a stalled stream after partial content and restarts with a clean backup", async () => {
    vi.useFakeTimers();
    mocks.primary.mockImplementation(async (_body, { signal }) => (async function* () {
      yield chunk('{"partial":');
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new APIUserAbortError()), { once: true }));
    })());
    mocks.backup.mockImplementation(() => chunks());
    const session = new AISession(body.model);
    const result = collect(await session.create({ ...body, stream: true })).catch(error => error);
    await vi.advanceTimersByTimeAsync(AI_REQUEST_IDLE_TIMEOUT_MS);
    expect(await result).toMatchObject({ retryWithFallback: true });
    expect(session.metadata.aiRouting.attempts[0]).toMatchObject({ abortCause: 'provider-timeout', durationMs: AI_REQUEST_IDLE_TIMEOUT_MS });
    expect((await collect(await session.create({ ...body, stream: true })))[0]).toEqual(chunk('{"ok":true}'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])("does not try backup after user cancellation (stream=%s)", async stream => {
    const controller = new AbortController();
    const session = new AISession(body.model);
    session.signal = controller.signal;
    mocks.primary.mockImplementation(() => {
      controller.abort(Object.assign(new Error("Cancelled"), { abortCause: "client-cancelled" }));
      throw new APIUserAbortError();
    });
    const request = stream ? collect(await session.create({ ...body, stream: true })) : session.create(body);
    await expect(request).rejects.toMatchObject({ abortCause: "client-cancelled" });
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it("preserves both failure reasons and stops when the backup fails", async () => {
    mocks.backup.mockRejectedValue(outage(429));
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ message: expect.stringMatching(/Primary AI failed:.*HTTP 402.*backup AI also failed/i), fallbackExhausted: true, status: 429 });
    expect(mocks.primary).toHaveBeenCalledOnce(); expect(mocks.backup).toHaveBeenCalledOnce();
  });
  it("honors the disable setting and unavailable backup credentials", async () => {
    vi.stubEnv("AI_FALLBACK_ENABLED", "false");
    await expect(new AISession(body.model).create(body)).rejects.toMatchObject({ status: 402 });
    vi.stubEnv("AI_FALLBACK_ENABLED", "true"); mocks.hasKey.mockImplementation(model => model !== AI_FALLBACK_MODEL);
    await expect(new AISession("gpt-5.4").create({ ...body, model: "gpt-5.4" })).rejects.toMatchObject({ status: 402 });
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it("uses the backup if the primary key is missing", async () => {
    mocks.hasKey.mockImplementation(model => model === AI_FALLBACK_MODEL);
    await new AISession("gpt-5.4").create({ ...body, model: "gpt-5.4" }); expect(mocks.primary).not.toHaveBeenCalled(); expect(mocks.backup).toHaveBeenCalledOnce();
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
  it("handles provider errors embedded in stream chunks", async () => {
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
    expect(() => session.assertValidFallback({ score: 69, issues: [] }, 70)).toThrow("Quality score 69 is below the required 70");
    expect(() => session.assertValidFallback({ score: 94, issues: [{ severity: "warning", message: "Check capacity" }] }, 70)).not.toThrow();
  });
  it("names the real reason when a high-scoring backup design misses the request", async () => {
    const session = new AISession(body.model); await session.create(body);
    const check = { complete: false, issues: [{ message: "Missing: Lynx Distributor" }] };
    const thrown = (() => { try { session.assertValidFallback({ score: 97, issues: [] }, 70, check); } catch (error: any) { return error.message; } })();
    expect(thrown).toContain("Missing: Lynx Distributor");
    expect(thrown).not.toContain("score");
  });
});
