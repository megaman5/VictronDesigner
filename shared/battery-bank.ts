import type { SchematicComponent, Wire } from "./schema";

// A battery bank is a set of batteries wired together in series. Voltage adds
// up across series-linked batteries while amp-hour capacity stays the same as
// the smallest member (the weakest link limits the bank).
export interface BatteryBank {
  batteryIds: string[];
  count: number;
  isSeries: boolean; // true when 2+ batteries are chained in series
  perBatteryVoltage: number; // nominal voltage of an individual battery
  bankVoltage: number; // total nominal voltage of the bank (series sum)
  capacityAh: number; // limiting amp-hour capacity of the bank
  energyWh: number; // usable-agnostic stored energy (bankVoltage * capacityAh)
  batteryType?: string;
  mixedVoltage: boolean; // members have differing nominal voltages
  mixedCapacity: boolean; // members have differing capacities
  mixedType: boolean; // members have differing chemistries
}

const batteryVoltage = (c: SchematicComponent): number =>
  Number(c.properties?.voltage) || 12;
const batteryCapacity = (c: SchematicComponent): number =>
  Number(c.properties?.capacity) || 0;
const batteryChemistry = (c: SchematicComponent): string =>
  String(c.properties?.batteryType || "LiFePO4");

/**
 * A series link is a wire that directly connects one battery's positive
 * terminal to a different battery's negative terminal. This is the defining
 * topology of a series string (12V + 12V = 24V).
 */
export function isSeriesLink(wire: Wire, components: SchematicComponent[]): boolean {
  if (!wire || wire.fromComponentId === wire.toComponentId) return false;
  const from = components.find((c) => c.id === wire.fromComponentId);
  const to = components.find((c) => c.id === wire.toComponentId);
  if (from?.type !== "battery" || to?.type !== "battery") return false;
  const terminals = [wire.fromTerminal, wire.toTerminal];
  return terminals.includes("positive") && terminals.includes("negative");
}

/**
 * Group batteries into banks by following series links. Each lone battery is
 * its own bank (isSeries = false); batteries chained by series links form a
 * single bank whose voltage is the sum of its members.
 */
export function findBatteryBanks(
  components: SchematicComponent[],
  wires: Wire[]
): BatteryBank[] {
  const batteries = components.filter((c) => c.type === "battery");
  if (batteries.length === 0) return [];

  const indexById = new Map(batteries.map((b, i) => [b.id, i]));

  // Union-find to group batteries connected by series links.
  const parent = batteries.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (const wire of wires) {
    if (!isSeriesLink(wire, components)) continue;
    const a = indexById.get(wire.fromComponentId);
    const b = indexById.get(wire.toComponentId);
    if (a !== undefined && b !== undefined) union(a, b);
  }

  const groups = new Map<number, SchematicComponent[]>();
  batteries.forEach((battery, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(battery);
    groups.set(root, group);
  });

  const banks: BatteryBank[] = [];
  for (const members of Array.from(groups.values())) {
    const voltages = members.map(batteryVoltage);
    const capacities = members.map(batteryCapacity);
    const types = members.map(batteryChemistry);
    const bankVoltage = voltages.reduce((sum, v) => sum + v, 0);
    const capacityAh = capacities.length ? Math.min(...capacities) : 0;

    banks.push({
      batteryIds: members.map((m) => m.id),
      count: members.length,
      isSeries: members.length > 1,
      perBatteryVoltage: voltages[0] ?? 12,
      bankVoltage,
      capacityAh,
      energyWh: bankVoltage * capacityAh,
      batteryType: types[0],
      mixedVoltage: new Set(voltages).size > 1,
      mixedCapacity: new Set(capacities).size > 1,
      mixedType: new Set(types).size > 1,
    });
  }

  return banks;
}

export function getBankForBattery(
  batteryId: string,
  banks: BatteryBank[]
): BatteryBank | undefined {
  return banks.find((b) => b.batteryIds.includes(batteryId));
}
