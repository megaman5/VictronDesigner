import type { BenchmarkCase } from './cases';
import { designRequirementsSchema } from '../../../shared/design-requirements';

const component = (id: string, type: string, properties: Record<string, unknown> = {}, index = 0) => ({ id, type, name: id, x: 100 + index * 260, y: 300, properties });
const battery = component('battery', 'battery', { voltage: 12, capacity: 100, batteryType: 'LiFePO4' });
const fuse = component('fuse', 'fuse', { fuseRating: 30, fuseType: 'midi' }, 1);
const load = component('load', 'dc-load', { watts: 60, voltage: 12 }, 2);
const wire = (id: string, from: string, to: string, fromTerminal: string, toTerminal: string, polarity = 'positive') => ({ id, fromComponentId: from, toComponentId: to, fromTerminal, toTerminal, polarity, length: 3, gauge: '10 AWG' });
const dcWires = [wire('main', 'battery', 'fuse', 'positive', 'in'), wire('load', 'fuse', 'load', 'out', 'positive'), wire('return', 'load', 'battery', 'negative', 'negative', 'negative')];
const preserved = { id: 'fixed-equipment-preserved', description: 'all fixed equipment remains present with original identifiers', check: (design: any) => design.components.length ? null : 'fixed equipment missing' };
function fixedCase(id: string, prompt: string, components: any[], wires: any[] = []): BenchmarkCase {
  return { id, prompt, systemVoltage: 12, minScore: 70, existingComponents: components, existingWires: wires, requirements: designRequirementsSchema.parse({ dcVoltage: 12, fixedEquipment: components.map(c => ({ id: c.id, type: c.type, properties: c.properties })) }), expectations: [preserved] };
}

/** Synthetic review fixtures, not copies of private production designs. */
export const AI_REGRESSION_CASES: BenchmarkCase[] = [
  fixedCase('simple-dc', 'Repair this declared 60W DC load circuit. Preserve measured three-foot lengths and all equipment.', [battery, fuse, load], dcWires),
  fixedCase('lynx-distribution', 'Wire the Lynx bus and load using the declared ratings; preserve fixed equipment.', [battery, fuse, component('lynx', 'lynx-distributor', { voltage: 12, amps: 1000 }, 2), { ...load, x: 880 }]),
  fixedCase('inverter-ac', 'Repair the inverter AC load circuit, preserving all declared specifications and measured wire lengths.', [battery, { ...fuse, properties: { fuseRating: 200, fuseType: 'class-t' } }, component('inverter', 'multiplus', { voltage: 12, watts: 2000, acOutputVoltage: '120' }, 2), component('ac-load', 'ac-load', { watts: 600, acVoltage: 120 }, 3)], [wire('main', 'battery', 'fuse', 'positive', 'in'), wire('dc', 'fuse', 'inverter', 'out', 'dc-positive'), wire('return', 'inverter', 'battery', 'dc-negative', 'negative', 'negative'), wire('hot', 'inverter', 'ac-load', 'ac-out-hot', 'hot', 'hot'), wire('neutral', 'inverter', 'ac-load', 'ac-out-neutral', 'neutral', 'neutral'), wire('ground', 'inverter', 'ac-load', 'ground', 'ground', 'ground')]),
  fixedCase('solar-mppt', 'Wire this 200W solar array, MPPT, protected battery, and declared DC load. Do not invent panel specifications.', [battery, fuse, load, component('solar', 'solar-panel', { watts: 200, voltage: 20, vmp: 20, voc: 24, isc: 11 }, 3), component('mppt', 'mppt', { voltage: 12, maxCurrent: 20, maxPVVoltage: 100, model: '100|20' }, 4)]),
  fixedCase('parallel-bank', 'Wire both batteries in the declared house bank and preserve the load; do not guess individual battery sharing.', [{ ...battery, properties: { ...battery.properties, batteryBankId: 'house' } }, component('battery-2', 'battery', { voltage: 12, capacity: 100, batteryBankId: 'house' }, 1), { ...fuse, x: 620 }, { ...load, x: 880 }, component('bus', 'busbar-positive', {}, 4)]),
  fixedCase('shore-ac', 'Repair this single-source 120V shore-power load circuit using the declared three-foot lengths.', [component('shore', 'shore-power', { acVoltage: 120, acOutputVoltage: '120', amps: 30 }), component('panel', 'ac-panel', { acVoltage: 120 }, 1), component('ac-load', 'ac-load', { acVoltage: 120, watts: 600 }, 2)], [wire('hot', 'shore', 'panel', 'ac-out-hot', 'main-in-hot', 'hot'), wire('neutral', 'shore', 'panel', 'ac-out-neutral', 'main-in-neutral', 'neutral'), wire('load-hot', 'panel', 'ac-load', 'load-1-hot', 'hot', 'hot'), wire('load-neutral', 'panel', 'ac-load', 'load-1-neutral', 'neutral', 'neutral')]),
  fixedCase('missing-equipment-eight', 'Wire the eight existing components without adding or removing equipment.', [battery, component('battery-2', 'battery', { voltage: 12 }, 1), component('inverter', 'multiplus', { watts: 3000 }, 2), component('shunt', 'smartshunt', {}, 3), component('cerbo', 'cerbo', {}, 4), component('mppt', 'mppt', { maxCurrent: 30 }, 5), component('orion', 'orion-dc-dc', { amps: 30 }, 6), component('bus', 'busbar-positive', {}, 7)]),
  fixedCase('unsupported-sharing', 'Preserve both parallel conductors and the fixed equipment; report unresolved sharing without guessing.', [battery, fuse, load], [...dcWires, { ...dcWires[1], id: 'parallel-load' }]),
];
