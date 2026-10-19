import { describe, expect, it, vi } from 'vitest';
import { AICorrectionTracker, candidateDecision, prefersAICandidate, semanticCandidateSignature, wirePreflight, wiringChanges } from '../../shared/ai-policy';
import { AI_REGRESSION_CASES } from '../../server/ai/benchmark/regression-cases';
import { annotateCandidate, createRequirementContext, preserveRepairEquipment, createAIRunBudget, AI_RUN_TIMEOUT_MS } from '../../server/ai/requirements';
import { analyzeElectricalDesign } from '../../shared/electrical-analysis';
import { checkDesignRequirements, designRequirementsSchema, extractDesignRequirements } from '../../shared/design-requirements';

const candidate = (score: number, issues: any[] = [], wires: any[] = []) => ({ components: [{ id: 'a', type: 'battery', properties: {} }], wires, validation: { score, issues }, review: { issues }, requirementCheck: { complete: true, issues: [] } });
describe('AI issue-aware corrections', () => {
  it('preflights the eight-component interrupted case with actionable equipment changes', () => {
    const fixture = AI_REGRESSION_CASES.find(c => c.id === 'missing-equipment-eight')!;
    expect(wirePreflight(fixture.existingComponents!, fixture.requirements).map(b => b.suggestedType).filter(Boolean)).toEqual(['fuse', 'solar-panel']);
    expect(wirePreflight([{ type: 'battery', id: 'b' }, { type: 'fuse', id: 'f' }])).toEqual([]);
  });
  it('prefers zero electrical errors to a higher numerical score', () => {
    expect(prefersAICandidate(candidate(90), candidate(100, [{ severity: 'error', category: 'electrical', message: 'Unfused battery' }]))).toBe(true);
    expect(candidateDecision(candidate(100, [{ severity: 'error', category: 'electrical', message: 'Unfused battery' }])).stop).toBe(false);
  });
  it('stops without regeneration when only missing specifications or unsupported sharing remain', () => {
    for (const message of ['Set load watts or amps.', 'Parallel paths or a circuit cycle prevent supported current sharing inference.', 'Confirm the AI-estimated physical wire length before relying on conductor sizing.']) {
      expect(candidateDecision(candidate(100, [{ severity: 'warning', category: 'unresolved', message }]))).toMatchObject({ stop: true, reason: 'unsupported-calculations' });
    }
  });
  it('continues to fix disconnected equipment even when reported as a warning', () => {
    const issue = { severity: 'warning', category: 'ai-quality', message: '1 component(s) not connected to any wires', componentIds: ['monitor'] };
    expect(candidateDecision(candidate(80, [issue]))).toMatchObject({ stop: false, reason: 'repairable-issues', continuationReasons: [issue.message] });
    const best = { components: [{ id: 'monitor', type: 'cerbo', properties: {} }], wires: [], review: { issues: [issue] } };
    const proposed = { components: [{ id: 'monitor', type: 'cerbo', properties: { amps: 0.2 } }], wires: [] };
    preserveRepairEquipment(proposed, best);
    expect(proposed.components[0].properties.amps).toBe(0.2);
  });
  it.each(['Change the battery cable length to 10 feet', 'Make all wire runs 10ft', 'Use shorter wiring lengths'])(
    'honors explicit wire length changes through preservation and annotation: %s', prompt => {
      const original = { id: 'w', fromComponentId: 'battery', toComponentId: 'load', fromTerminal: 'positive', toTerminal: 'positive', length: 20, gauge: '4 AWG', lengthEstimated: false };
      const best = { components: [], wires: [original], review: { issues: [] } };
      const context = createRequirementContext({ prompt, existingDesign: best });
      const proposed: any = { components: [], wires: [{ ...original, length: 10, gauge: '6 AWG' }] };
      preserveRepairEquipment(proposed, best, [], context.allowWireLengthChanges);
      annotateCandidate(proposed, context);
      expect(proposed.wires[0]).toMatchObject({ id: 'w', length: 10, gauge: '6 AWG', lengthEstimated: true });
    }
  );
  it('keeps supplied wire lengths during unrelated AI edits', () => {
    const original = { id: 'w', fromComponentId: 'battery', toComponentId: 'load', length: 20, lengthEstimated: false };
    const best = { components: [], wires: [original], review: { issues: [] } };
    const context = createRequirementContext({ prompt: 'Add a SmartShunt', existingDesign: best });
    const proposed: any = { components: [], wires: [{ ...original, length: 10 }] };
    preserveRepairEquipment(proposed, best, [], context.allowWireLengthChanges);
    annotateCandidate(proposed, context);
    expect(proposed.wires[0]).toMatchObject({ length: 20, lengthEstimated: false });
  });
  it('detects repetition despite reversed endpoints, new wire IDs, and drawing changes', () => {
    const wire = { id: 'original', fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'positive', toTerminal: 'in', gauge: '10 AWG', length: 3 };
    const a = candidate(50, [], [wire]);
    const b = candidate(50, [], [{ ...wire, id: 'new', fromComponentId: 'b', toComponentId: 'a', fromTerminal: 'in', toTerminal: 'positive' }]);
    expect(semanticCandidateSignature(a)).toBe(semanticCandidateSignature(b));
    const tracker = new AICorrectionTracker();
    expect(tracker.observe(a).stop).toBe(false); expect(tracker.observe(b).stop).toBe(false); expect(tracker.observe(a)).toMatchObject({ stop: true, reason: 'repeated-candidate' });
  });
  it('retains the best outcome from 0 → 70 → 90 → 70 → 70', () => {
    const tracker = new AICorrectionTracker(); let best: any;
    for (const [index, score] of [0, 70, 90, 70, 70].entries()) {
      const value = candidate(score, Array.from({ length: score === 90 ? 0 : 2 }, () => ({ severity: 'error', category: 'electrical', message: 'Repair required' })), [{ id: String(index), length: index }]);
      if (prefersAICandidate(value, best)) best = value;
      expect(tracker.observe(value).stop).toBe(index === 4);
    }
    expect(best.validation.score).toBe(90);
  });
  it('preserves both parallel conductors and their measured lengths during unrelated repair', () => {
    const wires = [1, 2].map(n => ({ id: `w${n}`, fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'positive', toTerminal: 'in', length: 5, gauge: '2/0 AWG' }));
    const proposed: any = { components: [], wires: [{ ...wires[0], id: 'invented', length: 99 }] };
    preserveRepairEquipment(proposed, { components: [], wires, validation: { issues: [] } });
    expect(proposed.wires).toEqual(wires);
    expect(wiringChanges(wires, proposed.wires)).toEqual({ added: [], removed: [] });
  });
  it('marks new AI lengths estimated and preserves input physical lengths', () => {
    const fixture = AI_REGRESSION_CASES[0];
    const context = createRequirementContext({ components: fixture.existingComponents, wires: fixture.existingWires, requirements: fixture.requirements });
    const result = annotateCandidate({ components: fixture.existingComponents, wires: [{ ...fixture.existingWires![0], length: 999 }, { id: 'new', fromComponentId: 'a', toComponentId: 'b', length: 3 }], validation: { score: 100, issues: [] } }, context);
    expect(result.wires[0]).toMatchObject({ length: 3, lengthEstimated: false });
    expect(result.wires[1].lengthEstimated).toBe(true);
    expect(result.runStatus.electricalCheck).not.toBe('passed');
  });
});

describe('Structured capacity and topology requirements', () => {
  it('extracts aggregate 3kW solar and 400Ah bank requirements without requiring each battery to be 400Ah', () => {
    const r = extractDesignRequirements('Design a 3kW solar system with 400Ah battery bank', 12);
    expect(r.aggregates?.map(a => a.minimum)).toEqual([400, 3000]);
    const components: any = [1, 2].map(n => ({ id: `b${n}`, type: 'battery', name: 'Battery', properties: { capacity: 200, voltage: 12 } }));
    components.push({ id: 'solar', type: 'solar-panel', name: 'Array', properties: { watts: 3000 } });
    expect(checkDesignRequirements(r, components, [], 12).issues).toEqual([]);
    expect(checkDesignRequirements(r, components.slice(0, 1), [], 12).issues).toHaveLength(2);
  });
  it('checks terminal-specific parallel conductor multiplicity and a declared protected path', () => {
    const r = designRequirementsSchema.parse({ dcVoltage: 12, connections: [{ id: 'pair', fromComponentId: 'a', toComponentId: 'b', polarity: 'positive', fromTerminal: 'positive', toTerminal: 'in', minimumWires: 2 }], paths: [{ id: 'protected-path', fromComponentId: 'a', toComponentId: 'c', polarity: 'positive', viaComponentIds: ['b'] }] });
    const components: any = ['a', 'b', 'c'].map(id => ({ id, type: 'fuse', name: id, properties: {} }));
    const wire: any = { fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'positive', toTerminal: 'in', polarity: 'positive' };
    expect(checkDesignRequirements(r, components, [wire], 12).issues).toHaveLength(2);
    expect(checkDesignRequirements(r, components, [{ ...wire, id: '1' }, { ...wire, id: '2' }, { id: '3', fromComponentId: 'b', toComponentId: 'c', polarity: 'positive' } as any], 12).complete).toBe(true);
    expect(designRequirementsSchema.parse({ dcVoltage: 12, constraints: [' ', ''] }).constraints).toEqual([]);
  });
});

describe('Expanded conservative electrical coverage', () => {
  const wire = (id: string, a: string, b: string, at: string, bt: string) => ({ id, fromComponentId: a, toComponentId: b, fromTerminal: at, toTerminal: bt, length: 3, gauge: '10 AWG' });
  it('resolves Lynx distribution and declared inverter DC demand without inventing AC utilization', () => {
    const components = [{ id: 'b', type: 'battery', properties: { voltage: 12 } }, { id: 'lynx', type: 'lynx-distributor' }, { id: 'inv', type: 'multiplus', properties: { dcInputAmps: 50 } }];
    const result = analyzeElectricalDesign({ components, systemVoltage: 12, wires: [wire('main', 'b', 'lynx', 'positive', 'main-positive'), wire('inv', 'lynx', 'inv', 'fuse-1', 'dc-positive')] });
    expect(result.wires.main.currentA).toBe(50); expect(result.wires.inv.currentA).toBe(50);
    expect(analyzeElectricalDesign({ components: [{ ...components[2], properties: {} }], systemVoltage: 12, wires: [] }).components.inv.status).toBe('unknown');
  });
  it('resolves common downstream demand for a declared parallel bank but never guesses individual sharing', () => {
    const components = ['a', 'b'].map(id => ({ id, type: 'battery', properties: { batteryBankId: 'house', voltage: 12 } }));
    const result = analyzeElectricalDesign({ systemVoltage: 12, components: [...components, { id: 'bus', type: 'busbar-positive', properties: {} }, { id: 'load', type: 'dc-load', properties: { amps: 10 } }], wires: [wire('a', 'a', 'bus', 'positive', 'pos-1'), wire('b', 'b', 'bus', 'positive', 'pos-2'), wire('load', 'bus', 'load', 'pos-3', 'positive')] });
    expect(result.wires.load).toMatchObject({ status: 'known', currentA: 10 });
    expect(result.wires.a.status).not.toBe('known'); expect(result.wires.b.status).not.toBe('known');
  });
});


describe('AI abort attribution', () => {
  it('clears the deadline when a response finishes, preventing late aborts', async () => {
    const { EventEmitter } = await import('node:events');
    vi.useFakeTimers();
    try {
      const res: any = new EventEmitter(); res.writableEnded = false;
      const budget = createAIRunBudget(res, 2);
      res.writableEnded = true; res.emit('finish');
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(AI_RUN_TIMEOUT_MS);
      expect(budget.signal.aborted).toBe(false);
      expect(res.listenerCount('close')).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('bounds the whole run and cancels a disconnected client', async () => {
    const { EventEmitter } = await import('node:events');
    vi.useFakeTimers();
    try {
      const res: any = new EventEmitter(); res.writableEnded = false;
      const budget = createAIRunBudget(res, 100);
      vi.advanceTimersByTime(AI_RUN_TIMEOUT_MS - 1);
      expect(budget.abortCause()).toBeUndefined();
      expect(budget.exhausted()).toBe(false);
      expect(budget.maxIterations).toBe(6);
      vi.advanceTimersByTime(1);
      expect(budget.abortCause()).toBe('run-deadline');
      expect(budget.exhausted()).toBe(true);
      const second: any = new EventEmitter(); second.writableEnded = false;
      const disconnected = createAIRunBudget(second, 2);
      second.emit('close');
      expect(disconnected.abortCause()).toBe('client-disconnected');
      expect(disconnected.signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
