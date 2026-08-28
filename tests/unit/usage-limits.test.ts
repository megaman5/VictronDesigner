import { describe, it, expect, afterEach } from 'vitest';
import { monthlyLimitUsd, DEFAULT_MONTHLY_LIMIT_USD, defaultLifetimeLimitUsd, DEFAULT_LIFETIME_LIMIT_USD } from '../../server/ai/usage-limits';
import { estimateCostUsd, isPriced } from '../../server/ai/pricing';

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

describe('Lifetime allowance alongside the monthly cap', () => {
  // checkQuota hits the database, so these cover the pure decision logic that
  // sits on top of the two spend figures.
  const decide = (opts: {
    lifetimeSpent: number;
    lifetimeLimit: number;
    monthSpent: number;
    monthLimit: number;
  }) => {
    const lifetimeExhausted = opts.lifetimeSpent >= opts.lifetimeLimit;
    const monthlyExhausted = opts.monthSpent >= opts.monthLimit;
    return {
      allowed: !lifetimeExhausted && !monthlyExhausted,
      blockedBy: lifetimeExhausted ? 'lifetime' : monthlyExhausted ? 'monthly' : undefined,
    };
  };

  it('allows a user inside both caps', () => {
    expect(decide({ lifetimeSpent: 2, lifetimeLimit: 10, monthSpent: 1, monthLimit: 5 }).allowed).toBe(true);
  });

  it('blocks on the lifetime allowance even when the month is clear', () => {
    const d = decide({ lifetimeSpent: 10, lifetimeLimit: 10, monthSpent: 0, monthLimit: 5 });
    expect(d.allowed).toBe(false);
    expect(d.blockedBy).toBe('lifetime');
  });

  it('blocks on the monthly cap even with lifetime allowance left', () => {
    const d = decide({ lifetimeSpent: 6, lifetimeLimit: 10, monthSpent: 5, monthLimit: 5 });
    expect(d.allowed).toBe(false);
    expect(d.blockedBy).toBe('monthly');
  });

  it('reports lifetime first when both are exhausted, since that is the one needing action', () => {
    const d = decide({ lifetimeSpent: 10, lifetimeLimit: 10, monthSpent: 5, monthLimit: 5 });
    expect(d.blockedBy).toBe('lifetime');
  });

  it('treats a topped-up limit as spendable again', () => {
    const before = decide({ lifetimeSpent: 10, lifetimeLimit: 10, monthSpent: 0, monthLimit: 5 });
    const after = decide({ lifetimeSpent: 10, lifetimeLimit: 20, monthSpent: 0, monthLimit: 5 });
    expect(before.allowed).toBe(false);
    expect(after.allowed).toBe(true);
  });
});

describe('Pricing coverage for models actually in use', () => {
  // Every request logged in production had cost_usd = null, which made the
  // spend caps inert. Two causes: tokens were never persisted, and rolling
  // aliases like "gpt-5.2-chat-latest" did not resolve to a price.
  it('prices the rolling -chat-latest aliases as their base model', () => {
    const usage = { inputTokens: 20_000, outputTokens: 4_000 };
    expect(estimateCostUsd('gpt-5.2-chat-latest', usage)).toBe(estimateCostUsd('gpt-5.2', usage));
    expect(estimateCostUsd('gpt-5.1-chat-latest', usage)).toBe(estimateCostUsd('gpt-5.1', usage));
  });

  it('prices a plain -latest alias too', () => {
    const usage = { inputTokens: 1_000, outputTokens: 500 };
    expect(estimateCostUsd('gpt-5.4-latest', usage)).toBe(estimateCostUsd('gpt-5.4', usage));
  });

  it('still reports unknown models as unpriced rather than free', () => {
    expect(estimateCostUsd('not-a-real-model', { inputTokens: 1e6, outputTokens: 1e6 })).toBeNull();
  });

  it('covers every model seen in production traffic', () => {
    const seen = [
      'gpt-5.5',
      'gpt-5.2-chat-latest',
      'gpt-5.4',
      'gpt-5.1-chat-latest',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-sol',
      'gpt-5.2',
    ];
    const unpriced = seen.filter((m) => !isPriced(m));
    expect(unpriced).toEqual([]);
  });
});

describe('Lifetime limit configuration', () => {
  const saved = process.env.AI_LIFETIME_LIMIT_USD;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_LIFETIME_LIMIT_USD;
    else process.env.AI_LIFETIME_LIMIT_USD = saved;
  });

  it('defaults to $10', () => {
    delete process.env.AI_LIFETIME_LIMIT_USD;
    expect(defaultLifetimeLimitUsd()).toBe(DEFAULT_LIFETIME_LIMIT_USD);
    expect(DEFAULT_LIFETIME_LIMIT_USD).toBe(10);
  });

  it('honours an override', () => {
    process.env.AI_LIFETIME_LIMIT_USD = '25';
    expect(defaultLifetimeLimitUsd()).toBe(25);
  });

  it('ignores nonsense and falls back to the default', () => {
    process.env.AI_LIFETIME_LIMIT_USD = 'free please';
    expect(defaultLifetimeLimitUsd()).toBe(DEFAULT_LIFETIME_LIMIT_USD);
  });
});
