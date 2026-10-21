/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { insert: () => ({ values: mocks.values }) } }));
vi.mock("../../server/ai/failure-alerts", () => ({ notifyAIFailure: vi.fn() }));
import { observabilityStorage } from "../../server/observability-storage";
import { estimateCostUsd } from "../../server/ai/pricing";
import { AI_FALLBACK_MODEL } from "../../server/ai/fallback";

describe("Fallback cost accounting", () => {
  beforeEach(() => { mocks.values.mockReset(); mocks.values.mockReturnValue({ returning: async () => [{ id: "log" }] }); });
  const common = { visitorId: "visitor", action: "generate-system", prompt: "test", systemVoltage: 12, success: true, durationMs: 100, model: AI_FALLBACK_MODEL };
  it("prices the backup's own tokens", async () => {
    const usage = { model: AI_FALLBACK_MODEL, inputTokens: 100, outputTokens: 100 };
    await observabilityStorage.logAIRequest({ ...common, inputTokens: 100, outputTokens: 100, modelUsage: [usage] });
    expect(Number(mocks.values.mock.calls[0][0].costUsd)).toBeCloseTo(estimateCostUsd(AI_FALLBACK_MODEL, usage)!);
  });
  it("adds primary and backup usage at each model's own price", async () => {
    const primary = { model: "gpt-5.4", inputTokens: 100_000, outputTokens: 10_000 };
    const backup = { model: AI_FALLBACK_MODEL, inputTokens: 200_000, outputTokens: 50_000 };
    await observabilityStorage.logAIRequest({ ...common, inputTokens: 300_000, outputTokens: 60_000, modelUsage: [primary, backup] });
    const row = mocks.values.mock.calls[0][0];
    expect(Number(row.costUsd)).toBeCloseTo(estimateCostUsd(primary.model, primary)! + estimateCostUsd(backup.model, backup)!);
    expect(row.response._debug.modelUsage).toEqual([primary, backup]);
  });
  it("keeps unknown primary costs unknown instead of pricing only the backup", async () => {
    await observabilityStorage.logAIRequest({ ...common, modelUsage: [{ model: "unknown-primary", inputTokens: 1, outputTokens: 1 }, { model: AI_FALLBACK_MODEL, inputTokens: 10, outputTokens: 10 }] });
    expect(mocks.values.mock.calls[0][0].costUsd).toBeNull();
  });
});
