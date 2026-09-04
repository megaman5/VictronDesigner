import { describe, it, expect, vi, beforeEach } from 'vitest';

const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: streamMock },
  })),
}));

// Imported after the mock so the provider picks up the mocked SDK.
const { anthropicProvider } = await import('../../server/ai/providers/anthropic');

function mockResponse(usage: Record<string, number> = {}) {
  return {
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-opus-5',
      usage: { input_tokens: 100, output_tokens: 10, ...usage },
    }),
  };
}

describe('Anthropic provider - request shape', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  it('streams instead of calling create, so long Fable turns do not hit the 10-minute non-streaming limit', async () => {
    streamMock.mockReturnValue(mockResponse());

    await anthropicProvider.chat(
      {
        model: 'claude-fable-5',
        messages: [
          { role: 'system', content: 'You are an expert.' },
          { role: 'user', content: 'Design a system' },
        ],
      },
      { apiKey: 'test-key' }
    );

    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('marks the system prompt as an ephemeral cache breakpoint', async () => {
    streamMock.mockReturnValue(mockResponse());

    await anthropicProvider.chat(
      {
        model: 'claude-fable-5',
        messages: [
          { role: 'system', content: 'You are an expert.' },
          { role: 'user', content: 'Design a system' },
        ],
      },
      { apiKey: 'test-key' }
    );

    const [params] = streamMock.mock.calls[0];
    expect(params.system).toEqual([
      { type: 'text', text: 'You are an expert.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('still caches the JSON-mode system prompt (instruction appended before the breakpoint)', async () => {
    streamMock.mockReturnValue(mockResponse());

    await anthropicProvider.chat(
      {
        model: 'claude-opus-5',
        json: true,
        messages: [
          { role: 'system', content: 'Rules.' },
          { role: 'user', content: 'Go' },
        ],
      },
      { apiKey: 'k' }
    );

    const [params] = streamMock.mock.calls[0];
    expect(params.system).toHaveLength(1);
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0].text).toContain('Rules.');
    expect(params.system[0].text).toContain('single valid JSON object');
  });

  it('omits system entirely when there is no system message', async () => {
    streamMock.mockReturnValue(mockResponse());

    await anthropicProvider.chat(
      { model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'k' }
    );

    const [params] = streamMock.mock.calls[0];
    expect(params.system).toBeUndefined();
  });

  it('reports cache_read_input_tokens as cachedInputTokens', async () => {
    streamMock.mockReturnValue(mockResponse({ cache_read_input_tokens: 30 }));

    const res = await anthropicProvider.chat(
      {
        model: 'claude-opus-5',
        messages: [
          { role: 'system', content: 'x' },
          { role: 'user', content: 'hi' },
        ],
      },
      { apiKey: 'k' }
    );

    expect(res.usage.cachedInputTokens).toBe(30);
  });
});
