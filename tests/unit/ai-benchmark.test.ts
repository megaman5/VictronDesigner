import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBenchmark, extractJson } from '../../server/ai/benchmark/runner';
import { getSuite, listSuites, CORE_SUITE } from '../../server/ai/benchmark/cases';
import { PROVIDERS } from '../../server/ai/providers';

describe('JSON extraction', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses a fenced object', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses an object with surrounding prose', () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps')).toEqual({ a: 1 });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('no json here')).toThrow(/No JSON object/);
  });
});

describe('Benchmark suites', () => {
  it('lists suites with case counts', () => {
    const suites = listSuites();
    expect(suites.length).toBeGreaterThan(0);
    expect(suites[0].caseCount).toBe(CORE_SUITE.cases.length);
  });

  it('throws helpfully on an unknown suite', () => {
    expect(() => getSuite('nope')).toThrow(/Unknown suite/);
  });

  it('every case declares a pass threshold and expectations', () => {
    for (const c of CORE_SUITE.cases) {
      expect(c.minScore).toBeGreaterThan(0);
      expect(c.expectations.length).toBeGreaterThan(0);
      expect(c.prompt.length).toBeGreaterThan(20);
    }
  });

  it('expectation checks return null when satisfied', () => {
    const design = {
      components: [
        { id: 'b1', type: 'battery', properties: { voltage: 12 } },
        { id: 'm1', type: 'mppt', properties: {} },
        { id: 's1', type: 'smartshunt', properties: {} },
        { id: 'sp', type: 'solar-panel', properties: { watts: 300, voltage: 18 } },
        { id: 'l1', type: 'dc-load', properties: { watts: 50 } },
      ],
      wires: [],
    };
    const van = CORE_SUITE.cases.find(c => c.id === 'van-12v')!;
    const failures = van.expectations.map(e => e.check(design as any)).filter(Boolean);
    expect(failures).toEqual([]);
  });

  it('expectation checks explain what is missing', () => {
    const van = CORE_SUITE.cases.find(c => c.id === 'van-12v')!;
    const noBattery = van.expectations.find(e => e.id === 'has-battery')!;
    expect(noBattery.check({ components: [], wires: [] } as any)).toContain('expected one of');
  });

  it('flags a 240V load with no split-phase source', () => {
    const split = CORE_SUITE.cases.find(c => c.id === 'split-240v')!;
    const check = split.expectations.find(e => e.id === '240v-supported')!;
    const bad = {
      components: [
        { type: 'ac-load', properties: { acVoltage: 240 } },
        { type: 'quattro', properties: { acOutputVoltage: '120' } },
      ],
      wires: [],
    };
    expect(check.check(bad as any)).toContain('no split-phase inverter');

    const good = {
      components: [
        { type: 'ac-load', properties: { acVoltage: 240 } },
        { type: 'quattro', properties: { acOutputVoltage: 'split-120-240' } },
      ],
      wires: [],
    };
    expect(check.check(good as any)).toBeNull();
  });
});

describe('Benchmark runner', () => {
  const VALID_DESIGN = JSON.stringify({
    components: [
      { id: 'b1', type: 'battery', name: 'Bank', x: 100, y: 300, properties: { voltage: 12, capacity: 200, batteryType: 'LiFePO4' } },
      { id: 'f1', type: 'fuse', name: 'Main', x: 400, y: 300, properties: { fuseType: 'class-t', fuseRating: 400 } },
    ],
    wires: [
      { fromComponentId: 'b1', toComponentId: 'f1', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', gauge: '4/0 AWG', length: 2 },
    ],
    description: 'test',
  });

  const stubProvider = (text: string, usage = { inputTokens: 100, outputTokens: 200 }) =>
    vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text,
      usage,
      samplingApplied: false,
      servedModel: 'stub',
    });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('runs every case and reports stats', async () => {
    stubProvider(VALID_DESIGN);
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4' });

    expect(summary.results).toHaveLength(CORE_SUITE.cases.length);
    expect(summary.stats.completedCount).toBe(CORE_SUITE.cases.length);
    expect(summary.stats.totalInputTokens).toBe(100 * CORE_SUITE.cases.length);
    expect(summary.usingPlatformKey).toBe(true);
  });

  it('repeats each case so variance can be measured', async () => {
    stubProvider(VALID_DESIGN);
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4', repeats: 3 });

    expect(summary.results).toHaveLength(CORE_SUITE.cases.length * 3);
    const repeats = summary.results.filter(r => r.caseId === 'van-12v').map(r => r.repeat);
    expect(repeats.sort()).toEqual([1, 2, 3]);
  });

  it('reports a standard deviation once there is more than one score', async () => {
    stubProvider(VALID_DESIGN);
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4' });
    expect(summary.stats.scoreStdDev).not.toBeNull();
  });

  it('records a failed case without aborting the run', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat').mockRejectedValue(new Error('upstream exploded'));
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4' });

    expect(summary.results.every(r => !r.success)).toBe(true);
    expect(summary.results[0].errorMessage).toContain('upstream exploded');
    expect(summary.stats.passRate).toBe(0);
  });

  it('survives unparseable model output', async () => {
    stubProvider('I am afraid I cannot do that');
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4' });
    expect(summary.results.every(r => !r.success)).toBe(true);
    expect(summary.results[0].errorMessage).toMatch(/No JSON object/);
  });

  it('reports null cost for an unpriced model instead of zero', async () => {
    stubProvider(VALID_DESIGN);
    // A model with no price entry must report unknown, never a misleading 0
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'some-unlisted-model' });
    expect(summary.results[0].costUsd).toBeNull();
    expect(summary.stats.totalCostUsd).toBeNull();
  });

  it('reports a real cost for a priced model', async () => {
    stubProvider(VALID_DESIGN, { inputTokens: 10_000, outputTokens: 10_000 });
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.6-luna' });
    expect(summary.results[0].costUsd).toBeGreaterThan(0);
    expect(summary.stats.totalCostUsd).toBeGreaterThan(0);
  });

  it('counts normalizer repairs so prompt quality is visible', async () => {
    // "main" is not a real bus bar terminal - the normalizer must repair it
    const needsRepair = JSON.stringify({
      components: [
        { id: 'b1', type: 'battery', name: 'Bank', x: 100, y: 300, properties: { voltage: 12, capacity: 200 } },
        { id: 'bus', type: 'busbar-positive', name: 'Bus', x: 500, y: 300, properties: {} },
      ],
      wires: [
        { fromComponentId: 'b1', toComponentId: 'bus', fromTerminal: 'positive', toTerminal: 'main', polarity: 'positive', gauge: '4/0 AWG', length: 2 },
      ],
    });
    stubProvider(needsRepair);
    const summary = await runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4' });
    expect(summary.stats.totalRepairs).toBeGreaterThan(0);
  });

  it('honours an abort signal', async () => {
    stubProvider(VALID_DESIGN);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBenchmark({ suiteId: 'core-designs', model: 'gpt-5.4', signal: controller.signal })
    ).rejects.toThrow(/aborted/);
  });
});

describe('Iterative refinement', () => {
  const design = (extra: Record<string, any> = {}) =>
    JSON.stringify({
      components: [
        { id: 'b1', type: 'battery', name: 'Bank', x: 100, y: 300, properties: { voltage: 12, capacity: 200, batteryType: 'LiFePO4' } },
        { id: 'f1', type: 'fuse', name: 'Main', x: 400, y: 300, properties: { fuseType: 'class-t', fuseRating: 400 } },
      ],
      wires: [
        { fromComponentId: 'b1', toComponentId: 'f1', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive', gauge: '4/0 AWG', length: 2 },
      ],
      ...extra,
    });

  beforeEach(() => { process.env.OPENAI_API_KEY = 'test-key'; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.OPENAI_API_KEY; });

  it('stops early once the target score is reached', async () => {
    const chat = vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: design(), usage: { inputTokens: 10, outputTokens: 10 }, samplingApplied: false,
    });
    const summary = await runBenchmark({
      suiteId: 'core-designs', model: 'gpt-5.4', iterations: 5, targetScore: 0,
    });
    // targetScore 0 is met on the first pass, so only one call per case
    expect(summary.results.every(r => r.iterationsUsed === 1)).toBe(true);
    expect(chat).toHaveBeenCalledTimes(CORE_SUITE.cases.length);
  });

  it('keeps iterating while below target and records the score path', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: design(), usage: { inputTokens: 10, outputTokens: 10 }, samplingApplied: false,
    });
    const summary = await runBenchmark({
      suiteId: 'core-designs', model: 'gpt-5.4', iterations: 3, targetScore: 101,
    });
    expect(summary.results.every(r => r.iterationsUsed === 3)).toBe(true);
    expect(summary.results[0].scorePath).toHaveLength(3);
    expect(summary.stats.meanIterations).toBe(3);
  });

  it('sums tokens across every pass', async () => {
    vi.spyOn(PROVIDERS.openai, 'chat').mockResolvedValue({
      text: design(), usage: { inputTokens: 100, outputTokens: 50 }, samplingApplied: false,
    });
    const summary = await runBenchmark({
      suiteId: 'core-designs', model: 'gpt-5.4', iterations: 2, targetScore: 101,
    });
    expect(summary.results[0].inputTokens).toBe(200);
    expect(summary.results[0].outputTokens).toBe(100);
  });

  it('keeps the best design when a later pass is worse', async () => {
    const good = design();
    // second pass returns a design with an unfused battery - a worse score
    const bad = JSON.stringify({
      components: [{ id: 'b1', type: 'battery', name: 'Bank', x: 100, y: 300, properties: { voltage: 12, capacity: 200 } },
                   { id: 'l1', type: 'dc-load', name: 'Load', x: 500, y: 300, properties: { watts: 1200, voltage: 12 } }],
      wires: [{ fromComponentId: 'b1', toComponentId: 'l1', fromTerminal: 'positive', toTerminal: 'positive', polarity: 'positive', gauge: '18 AWG', length: 30 }],
    });
    let call = 0;
    vi.spyOn(PROVIDERS.openai, 'chat').mockImplementation(async () => ({
      text: ++call % 2 === 1 ? good : bad,
      usage: { inputTokens: 10, outputTokens: 10 },
      samplingApplied: false,
    }));
    const summary = await runBenchmark({
      suiteId: 'core-designs', model: 'gpt-5.4', iterations: 2, targetScore: 101,
    });
    const first = summary.results[0];
    expect(first.score).toBe(Math.max(...first.scorePath));
  });
});
