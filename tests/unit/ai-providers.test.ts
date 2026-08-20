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
