/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ create: vi.fn(), log: vi.fn(), logError: vi.fn(), alert: vi.fn(), validate: vi.fn() }));
vi.mock("../../server/design-validator", () => ({ validateDesign: mocks.validate }));
vi.mock("../../server/ai/failure-alerts", () => ({ notifyAIFailure: mocks.alert }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/ai/routes", () => ({ registerAIRoutes: vi.fn() }));
vi.mock("../../server/schematic-renderer", () => ({
  renderSchematicToPNG: vi.fn(), getVisualFeedback: vi.fn(),
}));
vi.mock("../../server/observability-storage", () => ({
  observabilityStorage: { logAIRequest: mocks.log, logError: mocks.logError },
}));
vi.mock("../../server/ai/usage-limits", () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("../../server/app-settings-storage", () => ({
  DEFAULT_AI_MODEL: "gemini-3.8-flash", DEFAULT_WIRE_ROUTING_STYLE: "orthogonal",
  WIRE_ROUTING_STYLE_VALUES: ["orthogonal"],
  appSettingsStorage: { getAIModel: vi.fn().mockResolvedValue("gemini-3.8-flash") },
}));
vi.mock("../../server/ai/model-client", () => ({
  hasKeyForModel: () => true,
  clientForModel: () => ({ chat: { completions: { create: mocks.create } } }),
}));

describe("Production AI endpoints during a billing outage", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    const { registerRoutes } = await import("../../server/routes");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.isAuthenticated = (() => true) as any;
      req.user = { id: "test-user", email: "test@example.com" } as any;
      next();
    });
    server = await registerRoutes(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  beforeEach(() => {
    vi.stubEnv("AI_FALLBACK_ENABLED", "false");
    vi.clearAllMocks();
    mocks.create.mockRejectedValue(Object.assign(new Error("402 status code (no body)"), { status: 402 }));
    mocks.log.mockResolvedValue({ id: "failure-log" });
    mocks.logError.mockResolvedValue({ id: "provider-error" });
    mocks.alert.mockResolvedValue(undefined);
    mocks.validate.mockReturnValue({ score: 100, issues: [] });
  });

  it.each([
    ["/api/ai-generate-system-stream", { prompt: "Design a simple solar system", maxIterations: 6 }],
    ["/api/ai-generate-system", { prompt: "Design a simple solar system" }],
    ["/api/ai-generate-system-iterative", { prompt: "Design a simple solar system", maxIterations: 6 }],
    ["/api/ai-wire-components", { components: [{ id: "battery-1", type: "battery", x: 0, y: 0, properties: { voltage: 12 } }], maxIterations: 6 }],
  ])("%s preserves the cause, logs the failure, and stops retrying", async (endpoint, body) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const text = await response.text();
    expect(text).toContain("prepaid credits");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      success: false, model: "gemini-3.8-flash", errorMessage: expect.stringContaining("HTTP 402"),
    }));
  });

  const backupModel = "nvidia/nemotron-3-super-120b-a12b:free";
  const design = { components: [{ id: "battery-1", type: "battery", x: 100, y: 100, properties: { voltage: 12, capacity: 100 } }], wires: [] };
  const endpoints = [
    ["/api/ai-generate-system", { prompt: "Test system", maxIterations: 1 }],
    ["/api/ai-generate-system-iterative", { prompt: "Test system", maxIterations: 1 }],
    ["/api/ai-generate-system-stream", { prompt: "Test system", maxIterations: 1 }],
    ["/api/ai-wire-components", { components: design.components, maxIterations: 1 }],
  ] as const;
  function enableFallback() {
    vi.stubEnv("AI_FALLBACK_ENABLED", "true");
    mocks.create.mockImplementation(async body => {
      if (body.model !== backupModel) throw Object.assign(new Error("Credits depleted"), { status: 402 });
      const content = JSON.stringify(design);
      if (body.stream) return (async function* () {
        yield { choices: [{ delta: { content } }] };
        yield { choices: [], usage: { prompt_tokens: 20, completion_tokens: 10 } };
      })();
      return { choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } };
    });
  }
  async function post(endpoint: string, body: unknown) {
    const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { response, text: await response.text() };
  }
  it.each(endpoints)("%s recovers the outage, records the original failure, and identifies the backup", async (endpoint, body) => {
    enableFallback();
    const { response, text } = await post(endpoint, body);
    expect(response.status).toBe(200); expect(text).toContain('"usedFallback":true');
    expect(text).toContain(backupModel); expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.8-flash", errorMessage: expect.stringContaining("HTTP 402") }));
    expect(mocks.logError).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      success: true, provider: "openrouter", model: backupModel,
      aiRouting: expect.objectContaining({ primaryModel: "gemini-3.8-flash", usedFallback: true }),
      modelUsage: [{ model: backupModel, inputTokens: 20, outputTokens: 10 }],
    }));
  });
  it.each(endpoints)("%s rejects erroneous backup designs even with a high score", async (endpoint, body) => {
    enableFallback(); mocks.validate.mockReturnValue({ score: 95, issues: [{ severity: "error", category: "component", message: "Battery disconnected" }] });
    const { text } = await post(endpoint, body);
    expect(text).toContain("backup AI could not produce a design that passes validation");
    expect(text).not.toContain('"usedFallback":true');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ success: false, model: backupModel }));
  });
  it("restarts an interrupted stream in the same iteration without retaining partial JSON", async () => {
    enableFallback();
    mocks.create.mockImplementationOnce(async () => (async function* () {
      yield { choices: [{ delta: { content: '{"broken":' } }] };
      throw Object.assign(new Error("Connection lost"), { status: 503 });
    })());
    const { text } = await post("/api/ai-generate-system-stream", { prompt: "Test system", maxIterations: 1 });
    expect(text).toContain("event: ai-fallback"); expect(text).toContain("event: complete");
    expect(text).toContain('"finalIteration":1'); expect(text).not.toContain('"broken"');
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("stops streaming retries immediately when both providers fail", async () => {
    vi.stubEnv("AI_FALLBACK_ENABLED", "true");
    mocks.create.mockImplementation(async body => { throw Object.assign(new Error(body.model === backupModel ? "Backup rate limited" : "Credits depleted"), { status: body.model === backupModel ? 429 : 402 }); });
    const { text } = await post("/api/ai-generate-system-stream", { prompt: "Test system", maxIterations: 6 });
    expect(text).toContain("Primary AI failed:"); expect(text).toContain("Backup rate limited");
    expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.log).toHaveBeenCalledOnce();
  });

});
