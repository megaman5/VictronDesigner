import { describe, it, expect } from 'vitest';
import { estimateCostUsd, estimateFallbackCostUsd, isPriced } from '../../server/ai/pricing';

describe('estimateFallbackCostUsd', () => {
  it('never returns null, unlike estimateCostUsd', () => {
    expect(estimateCostUsd('totally-unknown-model', { inputTokens: 100, outputTokens: 100 })).toBeNull();
    expect(estimateFallbackCostUsd('totally-unknown-model')).toBeGreaterThan(0);
  });

  it('uses the real per-token rate for a known model at the flat token assumption', () => {
    const known = 'claude-sonnet-5';
    expect(isPriced(known)).toBe(true);
    const fallback = estimateFallbackCostUsd(known);
    const real = estimateCostUsd(known, { inputTokens: 25_000, outputTokens: 5_500 });
    expect(fallback).toBeCloseTo(real!, 6);
  });

  it('resolves rolling aliases the same as the real estimator', () => {
    const aliased = estimateFallbackCostUsd('gpt-5.2-chat-latest');
    const direct = estimateFallbackCostUsd('gpt-5.2');
    expect(aliased).toBeCloseTo(direct, 6);
  });

  it('is a small, sane dollar figure - not a runaway number', () => {
    expect(estimateFallbackCostUsd('claude-sonnet-5')).toBeLessThan(1);
    expect(estimateFallbackCostUsd(null)).toBeLessThan(1);
  });
});
