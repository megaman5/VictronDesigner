import nodemailer from "nodemailer";
import { redactSecrets } from "./key-vault";

export interface AIFailure {
  action: string;
  model?: string;
  errorMessage?: string;
}

// One email per action/model/error in 15 minutes; other failures still alert.
const sent = new Map<string, number>();
const pending = new Set<string>();
const cooldownMs = 15 * 60 * 1000;

export function aiAlertsConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export async function notifyAIFailure(failure: AIFailure): Promise<void> {
  if (!aiAlertsConfigured()) {
    console.error("[ai-alerts] Email alert unavailable: set SMTP_HOST and SMTP_FROM");
    return;
  }
  const key = JSON.stringify([failure.action, failure.model, failure.errorMessage]);
  const now = Date.now();
  sent.forEach((timestamp, entry) => {
    if (now - timestamp >= cooldownMs) sent.delete(entry);
  });
  if (pending.has(key) || sent.has(key)) return;
  pending.add(key);
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    ...(process.env.SMTP_USER ? {
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.AI_ALERT_EMAIL || "megaman5@gmail.com",
      subject: "VictronDesigner AI failure",
      // Do not include customer prompts, design data, or API credentials.
      text: [
        "An AI request failed on VictronDesigner.",
        `Time: ${new Date(now).toISOString()}`,
        `Feature: ${failure.action}`,
        `Model: ${failure.model || "unknown"}`,
        `Error: ${redactSecrets(failure.errorMessage || "Unknown failure").slice(0, 2000)}`,
        "Review details: https://victrondesigner.com/observability-admin",
        "Repeated identical failures are limited to one alert every 15 minutes.",
      ].join("\n"),
    });
    if (!result.accepted?.length) throw new Error("SMTP server did not accept the alert recipient");
    sent.set(key, Date.now());
    console.log("[ai-alerts] Failure email accepted by SMTP server");
  } catch (error) {
    console.error("[ai-alerts] Failed to send failure email:", error instanceof Error ? error.message : "Unknown mail error");
  } finally {
    pending.delete(key);
    transport.close();
  }
}
