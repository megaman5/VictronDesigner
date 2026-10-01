/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { describeAIError, isPermanentAIError } from "../../server/ai/errors";

describe("AI provider failures", () => {
  it("explains Google's body-less 402 billing rejection", () => {
    expect(describeAIError({ status: 402, message: "402 status code (no body)" }))
      .toContain("prepaid credits");
  });
  it("stops permanent errors but permits retries for temporary failures", () => {
    for (const status of [400, 401, 402, 403, 404, 422]) {
      expect(isPermanentAIError({ status })).toBe(true);
    }
    for (const status of [408, 409, 429, 500, 503]) {
      expect(isPermanentAIError({ status })).toBe(false);
    }
    expect(isPermanentAIError({ message: "Invalid JSON" } as any)).toBe(false);
  });
  it("preserves other error details", () => {
    expect(describeAIError({ status: 503, message: "Provider maintenance" })).toBe("Provider maintenance");
  });
});
