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
