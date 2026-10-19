/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ create: vi.fn(), log: vi.fn(), logError: vi.fn(), alert: vi.fn(), validate: vi.fn(), budgetMs: 240_000 }));
vi.mock('../../server/ai/requirements', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/ai/requirements')>();
  return { ...actual, createAIRunBudget: (res: any, iterations: unknown) => actual.createAIRunBudget(res, iterations, mocks.budgetMs) };
});
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

describe("Requirement-aware AI endpoints", () => {
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
    mocks.budgetMs = 240_000;
    vi.stubEnv("AI_FALLBACK_ENABLED", "false");
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ components: [{ id: "battery-1", type: "battery", name: "House", x: 100, y: 100, properties: { voltage: 12, capacity: 100 } }], wires: [] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    mocks.log.mockResolvedValue({ id: "failure-log" });
    mocks.logError.mockResolvedValue({ id: "provider-error" });
    mocks.alert.mockResolvedValue(undefined);
    mocks.validate.mockReturnValue({ score: 100, issues: [] });
  });


  it('returns incomplete requirements despite a perfect quality score', async () => {
    const response = await fetch(`${baseUrl}/api/ai-generate-system`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '2 batteries and a solar panel' }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.validation.score).toBe(100);
    expect(result.requirementCheck.status).toBe('incomplete');
    expect(result.requirementCheck.issues).toHaveLength(2);
    expect(mocks.log.mock.calls[0][0].response.attemptContext.inputSnapshot.prompt).toBe('2 batteries and a solar panel');
  });
  it('stops identical unmet repairs and never claims the quality threshold was achieved', async () => {
    const response = await fetch(`${baseUrl}/api/ai-generate-system-iterative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '2 batteries', maxIterations: 1000 }) });
    const result = await response.json();
    expect(result.requirementCheck.status).toBe('incomplete');
    expect(result.achievedQualityThreshold).toBe(false);
    expect(result.stopReason).toBe('repeated-candidate');
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(mocks.create.mock.calls[1][0].messages[1].content)).toContain('Requires 2 battery');
  });
  it.each(['/api/ai-generate-system', '/api/ai-generate-system-stream'])('rejects voltage contradictions without any model call at %s', async endpoint => {
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'battery', systemVoltage: 12, requirements: { dcVoltage: 48 } }) });
    expect(response.status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps supplied AI Wire equipment unchanged even when the provider returns replacement equipment', async () => {
    const components = [{ id: 'manual-battery', type: 'battery', name: 'My battery', x: 25, y: 75, properties: { voltage: 24, capacity: 300, note: 'manual' } }];
    const response = await fetch(`${baseUrl}/api/ai-wire-components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ components, systemVoltage: 24, maxIterations: 1 }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.components).toEqual(components);
  });
  it('returns equipment blockers without paying for a model call or changing the canvas', async () => {
    const { AI_REGRESSION_CASES } = await import('../../server/ai/benchmark/regression-cases');
    const components = AI_REGRESSION_CASES.find(c => c.id === 'missing-equipment-eight')!.existingComponents;
    const response = await fetch(`${baseUrl}/api/ai-wire-components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ components, systemVoltage: 12 }) });
    const result = await response.json();
    expect(result.stopReason).toBe('preflight-blocked');
    expect(result.iterations).toBe(0);
    expect(result.components).toEqual(components);
    expect(result.preflight.some((b: any) => b.suggestedType === 'fuse')).toBe(true);
    expect(result.preflight.some((b: any) => b.suggestedType === 'solar-panel')).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['/api/ai-generate-system', '/api/ai-generate-system-iterative', '/api/ai-wire-components', '/api/ai-generate-system-stream'])('sizes the restored physical length before returning %s', async endpoint => {
    const components = [{ id: 'b', type: 'battery', x: 100, y: 100, properties: { voltage: 12, capacity: 100 } },
      { id: 'f', type: 'fuse', x: 400, y: 100, properties: { fuseRating: 30 } },
      { id: 'l', type: 'dc-load', x: 700, y: 100, properties: { watts: 120, voltage: 12 } }];
    const wires = [
      { id: 'main', fromComponentId: 'b', toComponentId: 'f', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', length: 50, gauge: '18 AWG' },
      { id: 'feed', fromComponentId: 'f', toComponentId: 'l', fromTerminal: 'out', toTerminal: 'positive', polarity: 'positive', length: 50, gauge: '18 AWG' },
      { id: 'return', fromComponentId: 'l', toComponentId: 'b', fromTerminal: 'negative', toTerminal: 'negative', polarity: 'negative', length: 50, gauge: '18 AWG' },
    ];
    mocks.create.mockImplementation(async body => {
      const content = JSON.stringify({ components, wires: wires.map(w => ({ ...w, length: 1 })) });
      if (body.stream) return (async function* () { yield { choices: [{ delta: { content } }] }; })();
      return { choices: [{ message: { content } }] };
    });
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Keep this system', components, wires, existingDesign: { components, wires }, maxIterations: 1 }) });
    expect(response.status).toBe(200);
    const text = await response.text();
    const result = endpoint.endsWith('-stream') ? JSON.parse(text.match(/event: complete\ndata: ([^\n]+)/)![1]) : JSON.parse(text);
    expect(result.wires[1]).toMatchObject({ length: 50, lengthEstimated: false });
    expect(result.wires[1].gauge).not.toBe('18 AWG');
    expect(result.review.analysis.wires.feed.issues).toEqual([]);
  });

  it.each(['/api/ai-generate-system-iterative', '/api/ai-wire-components'])('keeps the best draft when a later %s response is malformed', async endpoint => {
    const components = [{ id: 'b', type: 'battery', x: 100, y: 100, properties: { voltage: 12 } }, { id: 'f', type: 'fuse', x: 400, y: 100, properties: { fuseRating: 30 } }];
    mocks.validate.mockReturnValue({ score: 50, issues: [{ severity: 'error', category: 'electrical', message: 'Missing connection', componentIds: ['b'] }] });
    mocks.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ components, wires: [] }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"wires":[' } }] });
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'battery', components, maxIterations: 3 }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.components).toEqual(components);
    expect(result.stopReason).toBe('invalid-provider-output');
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it.each(['Båt ☀️ 漢字', 'bad"\r\nX-Fake: injected'])('exports a report with a safe download header for %s', async name => {
    const response = await fetch(`${baseUrl}/api/export/system-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, components: [], wires: [], systemVoltage: 12 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('x-fake')).toBeNull();
    expect(await response.text()).toContain(name);
  });

  it('returns a deadline error when no candidate arrived, without starting backup AI', async () => {
    mocks.budgetMs = 50;
    mocks.create.mockImplementation((_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    const response = await fetch(`${baseUrl}/api/ai-generate-system-iterative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'battery' }) });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ abortCause: 'run-deadline' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('returns the best candidate when a later repair reaches the deadline', async () => {
    mocks.budgetMs = 50;
    mocks.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ components: [{ id: 'b', type: 'battery', x: 100, y: 100, properties: { voltage: 12 } }], wires: [] }) } }] })
      .mockImplementation((_body, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }));
    const response = await fetch(`${baseUrl}/api/ai-generate-system-iterative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '2 batteries', maxIterations: 6 }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stopReason: 'run-deadline', components: [{ id: 'b' }] });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

});
