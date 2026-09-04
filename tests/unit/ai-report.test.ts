import { describe, it, expect } from 'vitest';
import { renderExemplarReportHtml, type ExemplarReportRow } from '../../server/ai/benchmark/report';

const row = (over: Partial<ExemplarReportRow> = {}): ExemplarReportRow => ({
  caseId: 'van-12v',
  suiteId: 'core-designs',
  model: 'claude-fable-5',
  prompt: 'Design a 12V camper van system',
  systemVoltage: 12,
  componentCount: 16,
  wireCount: 22,
  validatorScore: 100,
  errors: [],
  warnings: [],
  dataUrl: 'data:image/png;base64,AAAA',
  panel: null,
  ...over,
});

describe('Exemplar HTML report', () => {
  it('embeds the rendered image so the file stands alone', () => {
    const html = renderExemplarReportHtml([row()]);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('shows each judge score and its written notes', () => {
    const html = renderExemplarReportHtml([
      row({
        panel: {
          score: 71,
          stdDev: 4.2,
          lowConfidence: false,
          costUsd: 0.004,
          usedExemplar: false,
          verdicts: [
            {
              model: 'gpt-5-mini',
              ok: true,
              overall: 71,
              dimensions: { layout: 70, routing: 68, correctness: 75, completeness: 72 },
              notes: 'Bus bars are cleanly separated.',
              inputTokens: 1, outputTokens: 1, costUsd: 0.002, durationMs: 10,
            },
          ],
        },
      }),
    ]);
    expect(html).toContain('gpt-5-mini');
    expect(html).toContain('Bus bars are cleanly separated.');
    expect(html).toContain('layout 70');
  });

  it('marks a low-confidence panel rather than presenting the number bare', () => {
    const html = renderExemplarReportHtml([
      row({ panel: { score: 60, stdDev: 22, lowConfidence: true, costUsd: null, usedExemplar: false, verdicts: [] } }),
    ]);
    expect(html).toContain('low confidence');
  });

  it('escapes model-written text instead of injecting it as markup', () => {
    const html = renderExemplarReportHtml([
      row({
        errors: ['<script>alert(1)</script>'],
        prompt: 'a & b "quoted"',
      }),
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b &quot;quoted&quot;');
  });

  it('lists validator errors and flags the score', () => {
    const html = renderExemplarReportHtml([
      row({ validatorScore: 40, errors: ['Wire gauge 10 AWG insufficient'] }),
    ]);
    expect(html).toContain('Wire gauge 10 AWG insufficient');
    expect(html).toContain('Validator errors (1)');
  });
});
