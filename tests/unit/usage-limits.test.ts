import { describe, it, expect, afterEach } from 'vitest';
import { monthlyLimitUsd, DEFAULT_MONTHLY_LIMIT_USD } from '../../server/ai/usage-limits';

describe('Monthly limit configuration', () => {
  const saved = process.env.AI_MONTHLY_LIMIT_USD;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_MONTHLY_LIMIT_USD;
    else process.env.AI_MONTHLY_LIMIT_USD = saved;
  });

  it('falls back to a sane default', () => {
    delete process.env.AI_MONTHLY_LIMIT_USD;
    expect(monthlyLimitUsd()).toBe(DEFAULT_MONTHLY_LIMIT_USD);
  });

  it('reads a configured limit', () => {
    process.env.AI_MONTHLY_LIMIT_USD = '25';
    expect(monthlyLimitUsd()).toBe(25);
  });

  it('allows an explicit zero (a hard stop on platform spend)', () => {
    process.env.AI_MONTHLY_LIMIT_USD = '0';
    expect(monthlyLimitUsd()).toBe(0);
  });

  it('ignores nonsense rather than failing open with no limit', () => {
    process.env.AI_MONTHLY_LIMIT_USD = 'not-a-number';
    expect(monthlyLimitUsd()).toBe(DEFAULT_MONTHLY_LIMIT_USD);
    process.env.AI_MONTHLY_LIMIT_USD = '-10';
    expect(monthlyLimitUsd()).toBe(DEFAULT_MONTHLY_LIMIT_USD);
  });
});

describe('Cost of a real design at each model price', () => {
  // Grounding the limit in measured usage: the iterative benchmark used
  // ~7.7k input and ~9.3k output tokens per generated design.
  const perDesign = { inputTokens: 7743, outputTokens: 9296 };

  it('shows what a $5 monthly cap actually buys', async () => {
    const { estimateCostUsd } = await import('../../server/ai/pricing');
    const rows = ['gpt-5.6-luna', 'gpt-5.4', 'gpt-5.6-sol', 'claude-opus-5'].map(m => ({
      model: m,
      cost: estimateCostUsd(m, perDesign)!,
    }));
    for (const r of rows) {
      expect(r.cost, `${r.model} should be priced`).toBeGreaterThan(0);
    }
    const luna = rows.find(r => r.model === 'gpt-5.6-luna')!.cost;
    const g54 = rows.find(r => r.model === 'gpt-5.4')!.cost;
    // luna buys roughly an order of magnitude more designs for the same cap
    expect(g54 / luna).toBeGreaterThan(10);
  });
});
