/** @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.createTransport } }));

describe("AI failure email delivery", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "alerts@example.com";
    process.env.AI_ALERT_EMAIL = "admin@example.com";
    mail.createTransport.mockReturnValue(mail);
    mail.sendMail.mockResolvedValue({ accepted: ["admin@example.com"] });
  });
  afterEach(() => { process.env = { ...saved }; });

  it("sends an alert and suppresses repeats while allowing a different failure", async () => {
    const { notifyAIFailure } = await import("../../server/ai/failure-alerts");
    const failure = { action: "wire-components", model: "gemini-3.8-flash", errorMessage: "HTTP 402" };
    await notifyAIFailure(failure);
    await notifyAIFailure(failure);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0][0]).toMatchObject({
      to: "admin@example.com", text: expect.stringContaining("HTTP 402"),
    });
    await notifyAIFailure({ ...failure, action: "generate-system" });
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
  });

  it("does not let failed SMTP delivery block a request or suppress the next alert", async () => {
    const { notifyAIFailure } = await import("../../server/ai/failure-alerts");
    mail.sendMail.mockRejectedValueOnce(new Error("mail unavailable"));
    const failure = { action: "iterate-design", errorMessage: "billing failure" };
    await expect(notifyAIFailure(failure)).resolves.toBeUndefined();
    await notifyAIFailure(failure);
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    expect(mail.close).toHaveBeenCalledTimes(2);
  });

  it("suppresses concurrent duplicates", async () => {
    const { notifyAIFailure } = await import("../../server/ai/failure-alerts");
    const failure = { action: "iterate-design", errorMessage: "billing failure" };
    await Promise.all([notifyAIFailure(failure), notifyAIFailure(failure)]);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it("allows a reminder after the cooldown expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000000);
    try {
      const { notifyAIFailure } = await import("../../server/ai/failure-alerts");
      const failure = { action: "wire-components", errorMessage: "billing failure" };
      await notifyAIFailure(failure);
      now.mockReturnValue(1000000 + 15 * 60 * 1000);
      await notifyAIFailure(failure);
      expect(mail.sendMail).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it("logs missing configuration without trying to deliver", async () => {
    delete process.env.SMTP_HOST;
    const { notifyAIFailure, aiAlertsConfigured } = await import("../../server/ai/failure-alerts");
    expect(aiAlertsConfigured()).toBe(false);
    await notifyAIFailure({ action: "generate-system" });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});
