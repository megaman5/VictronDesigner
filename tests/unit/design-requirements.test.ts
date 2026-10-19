import { describe, expect, it } from 'vitest';
import { checkDesignRequirements, designRequirementsSchema, extractDesignRequirements } from '../../shared/design-requirements';
import { annotateCandidate, createRequirementContext, prefersRequirementCandidate, preserveRepairEquipment } from '../../server/ai/requirements';
const battery = { id: 'battery-1', type: 'battery', name: 'House battery', x: 0, y: 0, properties: { capacity: 100 } };

describe('requirement-aware AI candidates', () => {
  it('detects requested quantities and omissions regardless of quality score', () => {
    const context = createRequirementContext({ prompt: '2 batteries and a solar panel', systemVoltage: 12 });
    const candidate = annotateCandidate({ components: [battery], wires: [], validation: { score: 100, issues: [] } }, context);
    expect(candidate.requirementCheck.issues).toHaveLength(2);
    expect(candidate.runStatus.requirementsCheck).toBe('incomplete');
    expect(candidate.runStatus.electricalCheck).toBe('passed');
  });
  it('retains the prompt as context without adding a blanket review blocker', () => {
    const context = createRequirementContext({ prompt: 'battery with cabin fridge', systemVoltage: 12 });
    const check = annotateCandidate({ components: [battery], wires: [] }, context).requirementCheck;
    expect(check.status).toBe('complete');
    expect(check.scope).toContain('Declared equipment');
    expect(check.uncheckedConstraints).toEqual(['battery with cabin fridge']);
  });
  it('checks reviewed capacities, named loads, and separate conductors', () => {
    const requirements = designRequirementsSchema.parse({ dcVoltage: 12, equipment: [{ id: 'house', type: 'battery', quantity: 1, minimumProperties: { capacity: 200 } }], connections: [{ id: 'negative', fromComponentId: 'battery-1', toComponentId: 'load-1', polarity: 'negative' }] });
    const result = checkDesignRequirements(requirements, [battery], [{ id: 'w', fromComponentId: 'battery-1', toComponentId: 'load-1', polarity: 'positive' } as any], 12);
    expect(result.complete).toBe(false);
    expect(result.issues.map(issue => issue.ruleId)).toEqual(['house', 'negative']);
  });
  it('rejects contradicting DC voltage before generation', () => {
    expect(() => createRequirementContext({ systemVoltage: 12, requirements: { dcVoltage: 48 } })).toThrow('contradicts');
  });
  it('does not count excluded equipment as required', () => {
    expect(extractDesignRequirements('battery without solar panels and no inverter', 12).equipment.map(item => item.type)).toEqual(['battery']);
  });
  it('prioritizes fewer unmet requirements over electrical quality', () => {
    expect(prefersRequirementCandidate({ complete: true, status: 'complete', checkedCount: 1, issues: [] }, { complete: false, status: 'incomplete', checkedCount: 1, issues: [{ ruleId: 'battery', category: 'requirements', severity: 'error', message: 'missing', componentIds: [] }] })).toBe(true);
  });
  it('preserves unaffected and fixed equipment through mocked repairs', () => {
    const candidate: any = { components: [{ ...battery, properties: { capacity: 1 } }], wires: [] };
    preserveRepairEquipment(candidate, { components: [battery], validation: { issues: [{ componentIds: ['battery-1'] }] } }, [battery]);
    expect(candidate.components).toEqual([battery]);
    const omitted: any = { components: [] };
    preserveRepairEquipment(omitted, { components: [battery], validation: { issues: [] } });
    expect(omitted.components).toEqual([battery]);
  });
  it('records stable snapshot hashes', () => {
    const body = { prompt: 'battery', systemVoltage: 12 };
    expect(createRequirementContext(body).inputHash).toEqual(createRequirementContext(body).inputHash);
    expect(createRequirementContext({ ...body, systemVoltage: 24 }).inputHash).not.toEqual(createRequirementContext(body).inputHash);
  });
});

import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { createAIRunBudget } from '../../server/ai/requirements';
describe('AI run budgets', () => {
  it('caps excessive requests and cancels disconnected responses', () => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const budget = createAIRunBudget(response as any, 10000);
    expect(budget.maxIterations).toBe(6);
    response.emit('close');
    expect(budget.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it('keeps connected requests alive past the old total time budget', () => {
    vi.useFakeTimers();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const budget = createAIRunBudget(response as any, 0);
    expect(budget.maxIterations).toBe(1);
    vi.advanceTimersByTime(240000);
    expect(budget.exhausted()).toBe(false);
    response.emit('finish');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
