import { describe, expect, it } from 'vitest';
import { aiResultNotice } from '../../client/src/lib/ai-result-notice';
import { parseAIDesign } from '../../server/ai/parse-design';

describe('AI completion notices', () => {
  it('shows remaining errors even when a request completed successfully', () => {
    expect(aiResultNotice({ runStatus: { electricalCheck: 'failed', electricalErrorCount: 3 } }, 'Wiring'))
      .toMatchObject({ title: 'Wiring draft needs corrections', description: expect.stringContaining('3 electrical errors'), variant: 'destructive' });
  });
  it('explains why the best draft was retained at the time limit', () => {
    expect(aiResultNotice({ stopReason: 'run-deadline', runStatus: { electricalCheck: 'incomplete' } }, 'Design').description)
      .toContain('time limit');
  });
  it('does not describe incomplete requirements as checked', () => {
    expect(aiResultNotice({ runStatus: { electricalCheck: 'passed', requirementsCheck: 'incomplete' } }, 'Design').title)
      .toBe('Design draft needs review');
  });
});

describe('AI output parsing', () => {
  it.each(['null', '[]', '{"components":{},"wires":[]}', '{"components":[null],"wires":[]}'])('rejects malformed design structure: %s', content => {
    expect(() => parseAIDesign(content)).toThrow('invalid design structure');
  });
  it('accepts fenced wire output and rejects a truncated response', () => {
    expect(parseAIDesign('```json\n{"wires":[]}\n```', true)).toEqual({ wires: [] });
    expect(() => parseAIDesign('{"wires":[', true)).toThrow('incomplete JSON');
  });
});
