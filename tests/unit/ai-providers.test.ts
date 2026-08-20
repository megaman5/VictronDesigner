import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inferProvider, resolveTarget, describeProviders, PROVIDERS } from '../../server/ai/providers';
import { ProviderError } from '../../server/ai/providers/types';
import { estimateCostUsd, lookupPrice, isPriced } from '../../server/ai/pricing';

describe('Provider inference', () => {
  it('routes vendor/model ids to OpenRouter', () => {
    expect(inferProvider('anthropic/claude-opus-5')).toBe('openrouter');
    expect(inferProvider('meta-llama/llama-4-maverick')).toBe('openrouter');
  });

  it('routes native model ids to their own provider', () => {
    expect(inferProvider('claude-opus-5')).toBe('anthropic');
    expect(inferProvider('gemini-2.5-pro')).toBe('gemini');
    expect(inferProvider('gpt-5.4')).toBe('openai');
  });

  it('exposes every provider with its platform-key status', () => {
    const described = describeProviders();
    expect(described.map(p => p.id).sort()).toEqual(
      ['anthropic', 'gemini', 'local', 'openai', 'openrouter']
    );
    for (const p of described) expect(typeof p.hasPlatformKey).toBe('boolean');
  });

  it('marks the local provider as needing a base URL', () => {
    expect(PROVIDERS.local.requiresBaseUrl).toBe(true);
    expect(PROVIDERS.openai.requiresBaseUrl).toBe(false);
  });
});

describe('Credential resolution', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('prefers a caller-supplied key over the platform key', () => {
    process.env.OPENAI_API_KEY = 'platform-key';
    const t = resolveTarget({ model: 'gpt-5.4', userCredentials: { apiKey: 'user-key' } });
    expect(t.credentials.apiKey).toBe('user-key');
    expect(t.usingPlatformKey).toBe(false);
  });

  it('falls back to the platform key', () => {
    process.env.OPENAI_API_KEY = 'platform-key';
    const t = resolveTarget({ model: 'gpt-5.4' });
    expect(t.credentials.apiKey).toBe('platform-key');
    expect(t.usingPlatformKey).toBe(true);
  });

  it('fails clearly when no key is available', () => {
    expect(() => resolveTarget({ model: 'claude-opus-5' })).toThrow(ProviderError);
    try {
      resolveTarget({ model: 'claude-opus-5' });
    } catch (e: any) {
      expect(e.message).toContain('ANTHROPIC_API_KEY');
    }
  });
});

describe('Cost estimation', () => {
  it('prices a known model', () => {
    const cost = estimateCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeCloseTo(5, 5);
  });

  it('prices input and output separately', () => {
    const cost = estimateCostUsd('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(25, 5);
  });

  it('discounts cached input tokens', () => {
    const uncached = estimateCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 })!;
    const cached = estimateCostUsd('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    })!;
    expect(cached).toBeLessThan(uncached);
  });

  it('returns null for an unpriced model rather than assuming zero', () => {
    expect(estimateCostUsd('some-unknown-model', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
    expect(isPriced('some-unknown-model')).toBe(false);
  });

  it('resolves prices through vendor prefixes and dated snapshots', () => {
    expect(lookupPrice('anthropic/claude-opus-5')).not.toBeNull();
    expect(lookupPrice('claude-opus-5-2026-01-01')).not.toBeNull();
  });
});

describe('Real-world pricing', () => {
  it('prices the models this app actually runs', () => {
    for (const m of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.4', 'gpt-5.5']) {
      expect(isPriced(m), `${m} should be priced`).toBe(true);
    }
  });

  it('reflects that luna is dramatically cheaper than gpt-5.4', () => {
    const usage = { inputTokens: 100_000, outputTokens: 100_000 };
    const luna = estimateCostUsd('gpt-5.6-luna', usage)!;
    const g54 = estimateCostUsd('gpt-5.4', usage)!;
    expect(luna).toBeLessThan(g54);
    // $1.40 vs $17.50 - an order of magnitude, which is decision-relevant
    expect(g54 / luna).toBeGreaterThan(10);
  });

  it('uses the first-party sol rate, not the lower OpenRouter listing', () => {
    // OpenRouter's feed says $2.50/$15; two other sources say $5/$30. Under-
    // counting spend is the worse failure for a budget cap.
    const cost = estimateCostUsd('gpt-5.6-sol', { inputTokens: 100_000, outputTokens: 0 })!;
    expect(cost).toBeCloseTo(0.5, 6); // $5/MTok
  });

  it('applies the OpenAI long-context surcharge above 272k input tokens', () => {
    const under = estimateCostUsd('gpt-5.4', { inputTokens: 272_000, outputTokens: 1000 })!;
    const over = estimateCostUsd('gpt-5.4', { inputTokens: 272_001, outputTokens: 1000 })!;
    expect(over).toBeGreaterThan(under * 1.9);
  });

  it('uses explicit cached rates where the vendor publishes them', () => {
    const allCached = estimateCostUsd('gpt-5.6-luna', {
      inputTokens: 100_000, outputTokens: 0, cachedInputTokens: 100_000,
    })!;
    expect(allCached).toBeCloseTo(0.002, 6); // luna cached input is $0.02/MTok
  });

  it('prices Gemini and Anthropic models too', () => {
    expect(isPriced('gemini-2.5-pro')).toBe(true);
    expect(isPriced('claude-opus-5')).toBe(true);
    expect(isPriced('anthropic/claude-sonnet-5')).toBe(true); // vendor-prefixed
  });
  it('does not apply OpenAI\'s long-context surcharge to other vendors', () => {
    // Anthropic and Google do not use the 272k rule; charging it would over-bill
    const anthropic = estimateCostUsd('claude-opus-5', { inputTokens: 500_000, outputTokens: 0 })!;
    expect(anthropic).toBeCloseTo(2.5, 5); // 0.5M * $5/MTok, no multiplier

    const gemini = estimateCostUsd('gemini-2.5-pro', { inputTokens: 500_000, outputTokens: 0 })!;
    expect(gemini).toBeCloseTo(0.625, 5); // 0.5M * $1.25/MTok
  });
});
