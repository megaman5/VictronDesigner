import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  aggregateVerdicts,
  judgeDesign,
  availableJudges,
  DEFAULT_JUDGE_MODELS,
  type JudgeVerdict,
} from '../../server/ai/benchmark/judge';
import { PROVIDERS } from '../../server/ai/providers';
import {
  messageText,
  splitDataUrl,
  toOpenAIContent,
  toAnthropicContent,
  toGeminiParts,
  type MessagePart,
} from '../../server/ai/providers/types';
import { skillFingerprint, systemDesignSkill, type Skill } from '../../server/ai/skills';

const verdict = (model: string, overall: number | null, ok = overall !== null): JudgeVerdict => ({
  model,
  ok,
  overall,
  dimensions: { layout: overall, routing: overall, correctness: overall, completeness: overall },
  notes: null,
  inputTokens: 100,
  outputTokens: 50,
  costUsd: ok ? 0.001 : null,
  durationMs: 10,
  ...(ok ? {} : { error: 'boom' }),
});

describe('Judge aggregation', () => {
  it('reports the median of an odd panel', () => {
    const panel = aggregateVerdicts([verdict('a', 40), verdict('b', 80), verdict('c', 60)], false);
    expect(panel.score).toBe(60);
    expect(panel.costUsd).toBeCloseTo(0.003);
  });

  it('averages the middle pair of an even panel', () => {
    const panel = aggregateVerdicts([verdict('a', 50), verdict('b', 70)], false);
    expect(panel.score).toBe(60);
  });

  it('ignores failed judges but keeps their verdicts visible', () => {
    const panel = aggregateVerdicts([verdict('a', 80), verdict('b', null)], false);
    expect(panel.score).toBe(80);
    expect(panel.verdicts).toHaveLength(2);
    expect(panel.verdicts[1].error).toBe('boom');
  });

  it('flags a single-judge verdict as low confidence', () => {
    const panel = aggregateVerdicts([verdict('a', 80)], false);
    expect(panel.lowConfidence).toBe(true);
    expect(panel.stdDev).toBeNull();
  });

  it('flags a split panel as low confidence', () => {
    const panel = aggregateVerdicts([verdict('a', 30), verdict('b', 90), verdict('c', 60)], false);
    expect(panel.lowConfidence).toBe(true);
    expect(panel.stdDev!).toBeGreaterThan(15);
  });

  it('trusts an agreeing panel', () => {
    const panel = aggregateVerdicts([verdict('a', 62), verdict('b', 65), verdict('c', 60)], true);
    expect(panel.lowConfidence).toBe(false);
    expect(panel.usedExemplar).toBe(true);
  });

  it('returns null score when every judge failed', () => {
    const panel = aggregateVerdicts([verdict('a', null), verdict('b', null)], false);
    expect(panel.score).toBeNull();
    expect(panel.costUsd).toBeNull();
    expect(panel.lowConfidence).toBe(true);
  });
});

describe('Judge panel selection', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('narrows the default panel to providers with keys', () => {
    process.env.OPENAI_API_KEY = 'k';
    expect(availableJudges()).toEqual(['gpt-5-mini']);
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(availableJudges()).toEqual(['gpt-5-mini', 'claude-haiku-4-5']);
  });

  it('default panel is all cheap models', () => {
    // Guard: nobody quietly swaps an expensive model into the routine path.
    expect(DEFAULT_JUDGE_MODELS).not.toContain('claude-fable-5');
    expect(DEFAULT_JUDGE_MODELS).not.toContain('claude-opus-5');
  });
});

describe('judgeDesign end to end (mocked providers)', () => {
  const design = {
    components: [
      { id: 'b1', type: 'battery', name: 'Bank', x: 200, y: 400, properties: { voltage: 12 } },
      { id: 'l1', type: 'dc-load', name: 'Fridge', x: 700, y: 400, properties: { watts: 60 } },
    ],
    wires: [
      {
        id: 'w1', fromComponentId: 'b1', toComponentId: 'l1',
        fromTerminal: 'positive', toTerminal: 'positive', polarity: 'positive',
      },
    ],
  };

  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('renders the design, sends it to each judge, and aggregates', async () => {
    const chat = vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: '{"overall": 72, "layout": 70, "routing": 75, "correctness": 74, "completeness": 68, "notes": "fine"}',
      usage: { inputTokens: 1200, outputTokens: 60 },
      samplingApplied: false,
    });

    const panel = await judgeDesign({
      design,
      prompt: 'Simple 12V system',
      systemVoltage: 12,
      judges: ['gpt-5-mini', 'gpt-5.2'],
    });

    expect(panel.score).toBe(72);
    expect(panel.verdicts.map(v => v.model)).toEqual(['gpt-5-mini', 'gpt-5.2']);
    expect(chat).toHaveBeenCalledTimes(2);

    // Every judge call carries the rendered candidate image.
    for (const call of chat.mock.calls) {
      const userMsg = call[0].messages.find(m => m.role === 'user')!;
      const parts = userMsg.content as MessagePart[];
      expect(parts.some(p => p.type === 'image' && p.dataUrl.startsWith('data:image/png;base64,'))).toBe(true);
    }

    // Both judges got the identical content - one render, not one per judge.
    expect(chat.mock.calls[0][0].messages[1].content).toBe(chat.mock.calls[1][0].messages[1].content);
  });

  it('attaches a second image and calibration wording when an exemplar exists', async () => {
    const chat = vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: '{"overall": 55}',
      usage: { inputTokens: 1500, outputTokens: 40 },
      samplingApplied: false,
    });

    const panel = await judgeDesign({
      design,
      prompt: 'Simple 12V system',
      systemVoltage: 12,
      exemplar: design,
      judges: ['gpt-5-mini'],
    });

    expect(panel.usedExemplar).toBe(true);
    const parts = chat.mock.calls[0][0].messages[1].content as MessagePart[];
    expect(parts.filter(p => p.type === 'image')).toHaveLength(2);
    expect((parts[0] as any).text).toContain('SECOND image');
  });

  it('survives one judge erroring', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat')
      .mockResolvedValueOnce({
        text: '{"overall": 64}',
        usage: { inputTokens: 1000, outputTokens: 30 },
        samplingApplied: false,
      })
      .mockRejectedValueOnce(new Error('rate limited'));

    const panel = await judgeDesign({
      design,
      prompt: 'Simple 12V system',
      systemVoltage: 12,
      judges: ['gpt-5-mini', 'gpt-5.2'],
    });

    expect(panel.score).toBe(64);
    expect(panel.lowConfidence).toBe(true);
    expect(panel.verdicts[1].error).toContain('rate limited');
  });

  it('retries a judge once and uses the second attempt', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat')
      .mockResolvedValueOnce({
        text: 'sorry, I cannot help with that',
        usage: { inputTokens: 900, outputTokens: 10 },
        samplingApplied: false,
      })
      .mockResolvedValueOnce({
        text: '{"overall": 70}',
        usage: { inputTokens: 900, outputTokens: 30 },
        samplingApplied: false,
      });

    const panel = await judgeDesign({
      design, prompt: 'Simple 12V system', systemVoltage: 12, judges: ['gpt-5-mini'],
    });
    expect(panel.score).toBe(70);
    expect(panel.verdicts[0].ok).toBe(true);
  });

  it('refuses when no judge can see images', async () => {
    await expect(
      judgeDesign({ design, prompt: 'x', systemVoltage: 12, judges: ['gpt-audio-1'] })
    ).rejects.toThrow(/No vision-capable judge/);
  });

  it('clamps out-of-range judge scores', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: '{"overall": 140, "layout": -5}',
      usage: { inputTokens: 900, outputTokens: 20 },
      samplingApplied: false,
    });
    const panel = await judgeDesign({
      design, prompt: 'x', systemVoltage: 12, judges: ['gpt-5-mini'],
    });
    expect(panel.score).toBe(100);
    expect(panel.verdicts[0].dimensions.layout).toBe(0);
  });
});

describe('Skill fingerprint', () => {
  it('is stable for the same skill', () => {
    expect(skillFingerprint(systemDesignSkill)).toBe(skillFingerprint(systemDesignSkill));
    expect(skillFingerprint(systemDesignSkill)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when prompt content changes, not when the version does', () => {
    const clone: Skill = { ...systemDesignSkill, version: 'totally-different' };
    expect(skillFingerprint(clone)).toBe(skillFingerprint(systemDesignSkill));

    const edited: Skill = {
      ...systemDesignSkill,
      buildSystemPrompt: ctx => systemDesignSkill.buildSystemPrompt(ctx) + '\nNEW RULE',
    };
    expect(skillFingerprint(edited)).not.toBe(skillFingerprint(systemDesignSkill));
  });
});

describe('Provider content mapping', () => {
  const parts: MessagePart[] = [
    { type: 'text', text: 'look at this' },
    { type: 'image', dataUrl: 'data:image/png;base64,AAAA' },
  ];

  it('passes plain strings through untouched', () => {
    expect(toOpenAIContent('hi')).toBe('hi');
    expect(toAnthropicContent('hi')).toBe('hi');
    expect(toGeminiParts('hi')).toEqual([{ text: 'hi' }]);
  });

  it('maps parts to each vendor shape', () => {
    expect(toOpenAIContent(parts)).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(toAnthropicContent(parts)).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
    expect(toGeminiParts(parts)).toEqual([
      { text: 'look at this' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('extracts text for system-prompt fields', () => {
    expect(messageText(parts)).toBe('look at this');
    expect(messageText('plain')).toBe('plain');
  });

  it('rejects a non-data-URL image', () => {
    expect(() => splitDataUrl('https://example.com/x.png')).toThrow(/data URL/);
  });
});
