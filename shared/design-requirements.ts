import { z } from 'zod';
import type { SchematicComponent, Wire } from './schema';

const origin = z.enum(['explicit', 'assumption']).default('explicit');
const notes = z.array(z.string()).default([]).transform(values => values.map(value => value.trim()).filter(Boolean));
export const designRequirementsSchema = z.object({
  version: z.literal(1).default(1),
  equipment: z.array(z.object({
    id: z.string(), type: z.string(), name: z.string().optional(),
    quantity: z.number().int().min(1).max(1000).default(1), origin,
    minimumProperties: z.record(z.number().nonnegative()).default({}),
  })).default([]),
  connections: z.array(z.object({
    id: z.string(), fromComponentId: z.string(), toComponentId: z.string(),
    polarity: z.string().optional(), origin,
    fromTerminal: z.string().optional(), toTerminal: z.string().optional(),
    gauge: z.string().optional(),
    minimumWires: z.number().int().min(1).max(20).optional(),
  })).default([]),
  aggregates: z.array(z.object({ id: z.string(), type: z.enum(['battery', 'solar-panel']), property: z.enum(['capacity', 'watts']), minimum: z.number().positive() })).optional(),
  paths: z.array(z.object({ id: z.string(), fromComponentId: z.string(), toComponentId: z.string(), polarity: z.string(), viaComponentIds: z.array(z.string()).default([]) })).optional(),
  fixedEquipment: z.array(z.object({ id: z.string(), type: z.string(), properties: z.record(z.unknown()).optional() })).optional(),
  dcVoltage: z.number().positive(),
  constraints: notes,
  preferences: notes,
  assumptions: notes,
});
export type DesignRequirements = z.infer<typeof designRequirementsSchema>;
export interface RequirementIssue { ruleId: string; severity: 'error' | 'warning'; category: 'requirements'; message: string; componentIds: string[]; }
export interface RequirementCheck { complete: boolean; status: 'complete' | 'incomplete' | 'needs-review'; checkedCount: number; issues: RequirementIssue[]; uncheckedConstraints?: string[]; scope?: string; }

// Deliberately conservative: richer/custom requests can supply reviewed structured
// requirements. The original prompt stays as context for AI iteration.
const equipmentPatterns: [string, string][] = [
  ['battery', 'batter(?:y|ies)(?: bank)?'], ['solar-panel', 'solar panels?'],
  ['mppt', '(?:mppt(?: controller)?|solar controller)s?'], ['smartshunt', 'smartshunts?'],
  ['multiplus', 'multiplus(?:-ii)?'], ['inverter', 'inverters?'],
  ['cerbo', 'cerbo(?: gx)?'], ['dc-panel', 'dc (?:distribution )?panels?'],
  ['ac-panel', 'ac (?:distribution )?panels?'], ['dc-load', 'dc loads?'], ['ac-load', 'ac loads?'],
];
export function extractDesignRequirements(prompt: string, dcVoltage: number): DesignRequirements {
  const equipment: DesignRequirements['equipment'] = [];
  for (const [type, pattern] of equipmentPatterns) {
    const regex = new RegExp(`\\b(?:(\\d+)\\s+)?(${pattern})\\b`, 'gi');
    for (const match of Array.from(prompt.matchAll(regex))) {
      const prefix = prompt.slice(Math.max(0, match.index! - 20), match.index!);
      if (/(?:no|without|exclude|not)\s+(?:any\s+)?$/i.test(prefix)) continue;
      equipment.push({ id: `equipment-${equipment.length + 1}`, type, quantity: Math.max(1, Math.min(Number(match[1] || 1), 1000)), origin: 'explicit', minimumProperties: {} });
    }
  }
  const aggregates: NonNullable<DesignRequirements['aggregates']> = [];
  const capacity = prompt.match(/\b(\d+(?:\.\d+)?)\s*ah\s+(?:\w+\s+){0,2}batter/i);
  if (capacity) aggregates.push({ id: 'aggregate.battery-capacity', type: 'battery', property: 'capacity', minimum: Number(capacity[1]) });
  const solar = prompt.match(/\b(\d+(?:\.\d+)?)\s*(kw|w)\s+(?:solar|pv)\b/i);
  if (solar) aggregates.push({ id: 'aggregate.solar-power', type: 'solar-panel', property: 'watts', minimum: Number(solar[1]) * (solar[2].toLowerCase() === 'kw' ? 1000 : 1) });
  return { version: 1, equipment, connections: [], aggregates, dcVoltage, constraints: prompt.trim() ? [prompt.trim()] : [], preferences: [], assumptions: [] };
}

function typeMatches(actual: string, required: string) {
  return actual === required || (required === 'inverter' && ['multiplus', 'quattro', 'phoenix-inverter'].includes(actual));
}
export function checkDesignRequirements(requirements: DesignRequirements, components: SchematicComponent[], wires: Wire[], systemVoltage: number): RequirementCheck {
  const issues: RequirementIssue[] = [];
  const add = (id: string, message: string, componentIds: string[] = []) => issues.push({ ruleId: id, severity: 'error', category: 'requirements', message, componentIds });
  if (requirements.dcVoltage !== systemVoltage) add('requirement.dc-voltage', `Requested ${requirements.dcVoltage}V DC; design uses ${systemVoltage}V DC.`);
  for (const requirement of requirements.equipment) {
    const matches = components.filter(component => typeMatches(component.type, requirement.type) &&
      (!requirement.name || component.name.toLowerCase().includes(requirement.name.toLowerCase())) &&
      Object.entries(requirement.minimumProperties).every(([key, value]) => Number(component.properties?.[key]) >= value));
    if (matches.length < requirement.quantity) add(requirement.id, `Requires ${requirement.quantity} ${requirement.name || requirement.type}; found ${matches.length} meeting the requested specifications.`, matches.map(component => component.id));
  }
  for (const requirement of requirements.connections) {
    const matches = wires.filter(wire => (!requirement.polarity || wire.polarity === requirement.polarity) && (!requirement.gauge || wire.gauge?.replace(/\s*AWG$/i, '').trim() === requirement.gauge.replace(/\s*AWG$/i, '').trim()) &&
      ((wire.fromComponentId === requirement.fromComponentId && wire.toComponentId === requirement.toComponentId && (!requirement.fromTerminal || wire.fromTerminal === requirement.fromTerminal) && (!requirement.toTerminal || wire.toTerminal === requirement.toTerminal)) ||
       (wire.toComponentId === requirement.fromComponentId && wire.fromComponentId === requirement.toComponentId && (!requirement.fromTerminal || wire.toTerminal === requirement.fromTerminal) && (!requirement.toTerminal || wire.fromTerminal === requirement.toTerminal))));
    if (new Set(matches.map(wire => wire.id)).size < (requirement.minimumWires ?? 1)) {
      add(requirement.id, `Missing required ${requirement.polarity || ''} connection ${requirement.fromComponentId} to ${requirement.toComponentId}.`, [requirement.fromComponentId, requirement.toComponentId]);
    }
  }
  for (const aggregate of requirements.aggregates ?? []) {
    const matches = components.filter(c => c.type === aggregate.type);
    const values = matches.map(c => Number(c.properties?.[aggregate.property]));
    const differentVoltage = aggregate.type === 'battery' && matches.some(c => Number(c.properties?.voltage ?? systemVoltage) !== systemVoltage);
    const total = values.reduce((sum, value) => sum + (Number.isFinite(value) && value >= 0 ? value : 0), 0);
    if (differentVoltage || values.some(v => !Number.isFinite(v) || v < 0) || total < aggregate.minimum) add(aggregate.id, differentVoltage ? 'Battery capacity at system voltage cannot be summed across different nominal battery voltages; declare the bank configuration.' : `Requires at least ${aggregate.minimum} ${aggregate.property === 'capacity' ? 'Ah at system voltage' : 'W'} of ${aggregate.type}; declared total is ${total}.`, matches.map(c => c.id));
  }
  for (const fixed of requirements.fixedEquipment ?? []) {
    const actual = components.find(c => c.id === fixed.id);
    if (!actual || actual.type !== fixed.type || Object.entries(fixed.properties ?? {}).some(([key, value]) => JSON.stringify(actual.properties?.[key]) !== JSON.stringify(value))) add(`fixed.${fixed.id}`, `Preserve fixed equipment ${fixed.id} and its declared properties.`, [fixed.id]);
  }
  for (const path of requirements.paths ?? []) {
    const chain = [path.fromComponentId, ...path.viaComponentIds, path.toComponentId];
    const connected = new Set(chain).size === chain.length && chain.every(id => components.some(c => c.id === id)) && chain.slice(1).every((to, index) => wires.some(wire => wire.polarity === path.polarity && ((wire.fromComponentId === chain[index] && wire.toComponentId === to) || (wire.toComponentId === chain[index] && wire.fromComponentId === to))));
    if (!connected) add(path.id, `Missing required ${path.polarity} path from ${path.fromComponentId} to ${path.toComponentId} through every declared intermediate component in order.`, chain);
  }
  const constraints = requirements.constraints.map(value => value.trim()).filter(Boolean);
  const complete = issues.length === 0;
  return { complete, status: complete ? 'complete' : 'incomplete', checkedCount: requirements.equipment.length + requirements.connections.length + (requirements.aggregates?.length ?? 0) + (requirements.paths?.length ?? 0) + (requirements.fixedEquipment?.length ?? 0) + 1, scope: 'Declared equipment, specifications, capacities, connections, paths, and DC voltage. Original prose is retained as AI context.', uncheckedConstraints: constraints, issues };
}
