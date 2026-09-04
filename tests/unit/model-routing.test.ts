/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clientForModel, hasKeyForModel } from '../../server/ai/model-client';

/**
 * Which vendor a configured model id is sent to. Before this existed, the
 * admin model setting fed every id to OpenAI, so choosing any other vendor's
 * model 404'd at request time rather than at configuration time.
 */
describe('Production model routing', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('sends a bare model id to OpenAI', () => {
    const client = clientForModel('gpt-5.4');
    expect(client.baseURL).toContain('api.openai.com');
    expect(client.apiKey).toBe('openai-key');
  });

  it('sends a vendor-prefixed id to OpenRouter with its own key', () => {
    const client = clientForModel('google/gemini-3.1-pro-preview');
    expect(client.baseURL).toContain('openrouter.ai');
    expect(client.apiKey).toBe('openrouter-key');
  });

  it('sends a bare gemini id to Google, not OpenAI', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    const client = clientForModel('gemini-3.1-pro-preview');
    expect(client.baseURL).toContain('generativelanguage.googleapis.com');
    expect(client.apiKey).toBe('gemini-key');
  });

  it('checks the key that the chosen model actually needs', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    delete process.env.OPENROUTER_API_KEY;
    expect(hasKeyForModel('gpt-5.4')).toBe(true);
    expect(hasKeyForModel('gemini-3.1-pro-preview')).toBe(true);
    expect(hasKeyForModel('google/gemini-3.1-pro-preview')).toBe(false);

    process.env.OPENROUTER_API_KEY = 'k';
    delete process.env.OPENAI_API_KEY;
    expect(hasKeyForModel('gpt-5.4')).toBe(false);
    expect(hasKeyForModel('google/gemini-3.1-pro-preview')).toBe(true);
  });
});
