export function describeAIError(error: { status?: number; message?: string; fallbackExhausted?: boolean }): string {
  if (error.fallbackExhausted && error.message) return error.message;
  if (error.status === 402) {
    return "AI provider billing is unavailable (HTTP 402). The provider's prepaid credits may be depleted; the administrator must check billing and add credits.";
  }
  return error.message || "AI request failed";
}

export function isPermanentAIError(error: { status?: number }): boolean {
  return typeof error.status === "number" && error.status >= 400 && error.status < 500
    && ![408, 409, 429].includes(error.status);
}

/**
 * Replace an error's message. Plain assignment throws on a DOMException
 * (the AbortError a cancelled or timed-out fetch rejects with), whose
 * message is a read-only getter - and that second error replaced the real
 * one, inside the very catch blocks that log the failure and answer the user.
 */
export function setErrorMessage(error: any, message: string): void {
  if (!error || typeof error !== "object") return;
  try { Object.defineProperty(error, "message", { value: message, configurable: true, writable: true, enumerable: false }); } catch { /* frozen: keep the original */ }
}
