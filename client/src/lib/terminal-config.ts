export type TerminalOrientation = "left" | "right" | "top" | "bottom";

export interface Terminal {
  id: string;
  type: "positive" | "negative" | "hot" | "neutral" | "ground" | "ac-in" | "ac-out" | "pv-positive" | "pv-negative";
  label: string;
  x: number; // Relative to component's top-left corner
  y: number; // Relative to component's top-left corner
  color: string;
  orientation: TerminalOrientation; // Direction wire should exit
}

export interface ComponentTerminalConfig {
  width: number;
  height: number;
  terminals: Terminal[];
}

// Terminal configurations for each component type
export const TERMINAL_CONFIGS: Record<string, ComponentTerminalConfig> = {
  // Generic user-defined component. Provides DC +/- on both sides so it can be
  // wired inline (e.g. a device we don't have a dedicated symbol for yet).
  custom: {
    width: 160,
    height: 120,
    terminals: [
      { id: "in-positive", type: "positive", label: "IN+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "in-negative", type: "negative", label: "IN-", x: 8, y: 80, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "out-positive", type: "positive", label: "OUT+", x: 152, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "out-negative", type: "negative", label: "OUT-", x: 152, y: 80, color: "hsl(var(--wire-negative))", orientation: "right" },
    ],
  },

  multiplus: {
    width: 180,
    height: 140,
    terminals: [
      { id: "ac-in-hot", type: "ac-in", label: "AC IN L", x: 20, y: 148, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "ac-in-neutral", type: "ac-in", label: "AC IN N", x: 40, y: 148, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "ac-in-ground", type: "ground", label: "AC IN G", x: 60, y: 148, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "ac-out-hot", type: "ac-out", label: "AC OUT L", x: 80, y: 148, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "ac-out-neutral", type: "ac-out", label: "AC OUT N", x: 100, y: 148, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "ac-out-ground", type: "ground", label: "AC OUT G", x: 120, y: 148, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "dc-positive", type: "positive", label: "DC+", x: 140, y: 148, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 160, y: 148, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },

  quattro: {
    width: 240,
    height: 150,
    terminals: [
      { id: "ac-in-1-hot", type: "ac-in", label: "AC1 L", x: 20, y: 158, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "ac-in-1-neutral", type: "ac-in", label: "AC1 N", x: 40, y: 158, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "ac-in-1-ground", type: "ground", label: "AC1 G", x: 60, y: 158, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "ac-in-2-hot", type: "ac-in", label: "AC2 L", x: 85, y: 158, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "ac-in-2-neutral", type: "ac-in", label: "AC2 N", x: 105, y: 158, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "ac-in-2-ground", type: "ground", label: "AC2 G", x: 125, y: 158, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "ac-out-hot", type: "ac-out", label: "AC OUT L", x: 150, y: 158, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "ac-out-neutral", type: "ac-out", label: "AC OUT N", x: 170, y: 158, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "ac-out-ground", type: "ground", label: "AC OUT G", x: 190, y: 158, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "dc-positive", type: "positive", label: "DC+", x: 212, y: 158, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 232, y: 158, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },

  argofet: {
    width: 150,
    height: 110,
    terminals: [
      { id: "input-positive", type: "positive", label: "ALT+", x: 8, y: 55, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "out-1-positive", type: "positive", label: "BAT1+", x: 142, y: 30, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "out-2-positive", type: "positive", label: "BAT2+", x: 142, y: 55, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "out-3-positive", type: "positive", label: "BAT3+", x: 142, y: 80, color: "hsl(var(--wire-positive))", orientation: "right" },
    ],
  },

  "cyrix-ct": {
    width: 130,
    height: 90,
    terminals: [
      { id: "batt-1-positive", type: "positive", label: "BAT1+", x: 8, y: 45, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "batt-2-positive", type: "positive", label: "BAT2+", x: 122, y: 45, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "ground", type: "negative", label: "GND", x: 65, y: 98, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },

  mppt: {
    width: 160,
    height: 130,
    terminals: [
      { id: "pv-positive", type: "pv-positive", label: "PV+", x: 30, y: 108, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pv-negative", type: "pv-negative", label: "PV-", x: 50, y: 108, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "batt-positive", type: "positive", label: "BATT+", x: 110, y: 108, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "batt-negative", type: "negative", label: "BATT-", x: 130, y: 108, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },

  cerbo: {
    width: 180,
    height: 120,
    terminals: [
      { id: "power-positive", type: "positive", label: "PWR+", x: 8, y: 50, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "power-negative", type: "negative", label: "PWR-", x: 8, y: 70, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "ve-bus", type: "ground", label: "VE.Bus", x: 172, y: 33, color: "hsl(var(--muted))", orientation: "right" },
      { id: "ve-direct", type: "ground", label: "VE.Direct", x: 172, y: 50, color: "hsl(var(--muted))", orientation: "right" },
      { id: "ve-can", type: "ground", label: "CAN", x: 172, y: 67, color: "hsl(var(--muted))", orientation: "right" },
    ],
  },

  bmv: {
    width: 140,
    height: 140,
    terminals: [
      { id: "data", type: "ground", label: "VE.Direct", x: 132, y: 59, color: "hsl(var(--muted))", orientation: "right" },
    ],
  },

  battery: {
    width: 160,
    height: 110,
    terminals: [
      { id: "negative", type: "negative", label: "-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "positive", type: "positive", label: "+", x: 152, y: 60, color: "hsl(var(--wire-positive))", orientation: "right" },
    ],
  },

  "solar-panel": {
    width: 140,
    height: 120,
    terminals: [
      { id: "positive", type: "pv-positive", label: "+", x: 60, y: 112, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "negative", type: "pv-negative", label: "-", x: 80, y: 112, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },

  "ac-load": {
    width: 120,
    height: 100,
    terminals: [
      { id: "hot", type: "ac-in", label: "L", x: 8, y: 40, color: "hsl(var(--wire-ac-hot))", orientation: "left" },
      { id: "neutral", type: "ac-in", label: "N", x: 8, y: 55, color: "hsl(var(--wire-neutral))", orientation: "left" },
      { id: "ground", type: "ground", label: "G", x: 8, y: 70, color: "hsl(var(--wire-ac-ground))", orientation: "left" },
    ],
  },

  "dc-load": {
    width: 120,
    height: 100,
    terminals: [
      { id: "positive", type: "positive", label: "+", x: 8, y: 42, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "negative", type: "negative", label: "-", x: 8, y: 61, color: "hsl(var(--wire-negative))", orientation: "left" },
    ],
  },

  smartshunt: {
    width: 140,
    height: 130,
    terminals: [
      { id: "negative", type: "negative", label: "BATT-", x: 20, y: 90, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "system-minus", type: "negative", label: "SYS-", x: 70, y: 90, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "data", type: "ground", label: "VE.Direct", x: 120, y: 90, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  "orion-dc-dc": {
    width: 160,
    height: 120,
    terminals: [
      { id: "input-positive", type: "positive", label: "IN+", x: 8, y: 50, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "input-negative", type: "negative", label: "IN-", x: 8, y: 70, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "output-positive", type: "positive", label: "OUT+", x: 152, y: 50, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "output-negative", type: "negative", label: "OUT-", x: 152, y: 70, color: "hsl(var(--wire-negative))", orientation: "right" },
      { id: "remote", type: "ground", label: "REM", x: 80, y: 112, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  "battery-balancer": {
    width: 150,
    height: 120,
    terminals: [
      { id: "bank-positive", type: "positive", label: "24V+", x: 75, y: 8, color: "hsl(var(--wire-positive))", orientation: "top" },
      { id: "midpoint", type: "positive", label: "MID", x: 8, y: 60, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "bank-negative", type: "negative", label: "0V-", x: 75, y: 112, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "alarm", type: "ground", label: "ALARM", x: 142, y: 60, color: "hsl(var(--muted))", orientation: "right" },
    ],
  },

  "phoenix-inverter": {
    width: 160,
    height: 130,
    terminals: [
      { id: "dc-positive", type: "positive", label: "DC+", x: 19, y: 55, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 19, y: 75, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "ac-out-hot", type: "ac-out", label: "AC L", x: 141, y: 45, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "ac-out-neutral", type: "ac-out", label: "AC N", x: 141, y: 65, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "ac-out-ground", type: "ground", label: "AC G", x: 141, y: 85, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
      { id: "remote", type: "ground", label: "REM", x: 80, y: 100, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  // Lynx modular DC distribution system. All Lynx modules share the same
  // 1000A positive/negative busbar pair, so they bolt together side by side:
  // wire "bus-out-*" of one module to "main-*" of the next.
  "lynx-distributor": {
    width: 220,
    height: 100,
    terminals: [
      { id: "main-positive", type: "positive", label: "BUS+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "main-negative", type: "negative", label: "BUS-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "bus-out-positive", type: "positive", label: "OUT+", x: 212, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "bus-out-negative", type: "negative", label: "OUT-", x: 212, y: 60, color: "hsl(var(--wire-negative))", orientation: "right" },
      { id: "fuse-1", type: "positive", label: "F1", x: 60, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-2", type: "positive", label: "F2", x: 100, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-3", type: "positive", label: "F3", x: 140, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-4", type: "positive", label: "F4", x: 180, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "neg-1", type: "negative", label: "N1", x: 60, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-2", type: "negative", label: "N2", x: 100, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-3", type: "negative", label: "N3", x: 140, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-4", type: "negative", label: "N4", x: 180, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
    ],
  },

  // Lynx Power In: passive 1000A busbar pair, four unfused +/- connection pairs.
  "lynx-power-in": {
    width: 220,
    height: 100,
    terminals: [
      { id: "main-positive", type: "positive", label: "BUS+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "main-negative", type: "negative", label: "BUS-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "bus-out-positive", type: "positive", label: "OUT+", x: 212, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "bus-out-negative", type: "negative", label: "OUT-", x: 212, y: 60, color: "hsl(var(--wire-negative))", orientation: "right" },
      { id: "pos-1", type: "positive", label: "P1", x: 60, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-2", type: "positive", label: "P2", x: 100, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-3", type: "positive", label: "P3", x: 140, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-4", type: "positive", label: "P4", x: 180, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "neg-1", type: "negative", label: "N1", x: 60, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-2", type: "negative", label: "N2", x: 100, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-3", type: "negative", label: "N3", x: 140, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
      { id: "neg-4", type: "negative", label: "N4", x: 180, y: 8, color: "hsl(var(--wire-negative))", orientation: "top" },
    ],
  },

  // Lynx Shunt VE.Can: busbar pair with an integrated 1000A shunt on the
  // negative bar and a main fuse holder on the positive bar.
  "lynx-shunt": {
    width: 220,
    height: 120,
    terminals: [
      { id: "batt-positive", type: "positive", label: "BATT+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "batt-negative", type: "negative", label: "BATT-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "bus-out-positive", type: "positive", label: "SYS+", x: 212, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "bus-out-negative", type: "negative", label: "SYS-", x: 212, y: 60, color: "hsl(var(--wire-negative))", orientation: "right" },
      { id: "ve-can", type: "ground", label: "VE.Can", x: 110, y: 112, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  // Lynx Smart BMS: shunt + contactor + BMS for Victron lithium banks.
  "lynx-smart-bms": {
    width: 220,
    height: 140,
    terminals: [
      { id: "batt-positive", type: "positive", label: "BATT+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "batt-negative", type: "negative", label: "BATT-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "system-positive", type: "positive", label: "SYS+", x: 212, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "system-negative", type: "negative", label: "SYS-", x: 212, y: 60, color: "hsl(var(--wire-negative))", orientation: "right" },
      { id: "bms-can", type: "ground", label: "BMS-Can", x: 60, y: 132, color: "hsl(var(--muted))", orientation: "bottom" },
      { id: "ve-can", type: "ground", label: "VE.Can", x: 110, y: 132, color: "hsl(var(--muted))", orientation: "bottom" },
      { id: "allow-to-charge", type: "ground", label: "ATC", x: 160, y: 132, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  "battery-protect": {
    width: 120,
    height: 100,
    terminals: [
      { id: "input-positive", type: "positive", label: "IN", x: -8, y: 50, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "output-positive", type: "positive", label: "OUT", x: 128, y: 50, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "ground", type: "negative", label: "GND", x: 60, y: 108, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "remote", type: "ground", label: "REM", x: 90, y: 108, color: "hsl(var(--muted))", orientation: "bottom" },
    ],
  },

  "blue-smart-charger": {
    width: 140,
    height: 120,
    terminals: [
      { id: "ac-in-hot", type: "ac-in", label: "AC L", x: 8, y: 35, color: "hsl(var(--wire-ac-hot))", orientation: "left" },
      { id: "ac-in-neutral", type: "ac-in", label: "AC N", x: 8, y: 60, color: "hsl(var(--wire-neutral))", orientation: "left" },
      { id: "ac-in-ground", type: "ground", label: "AC G", x: 8, y: 85, color: "hsl(var(--wire-ac-ground))", orientation: "left" },
      { id: "dc-positive", type: "positive", label: "DC+", x: 132, y: 50, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 132, y: 70, color: "hsl(var(--wire-negative))", orientation: "right" },
    ],
  },

  "busbar-positive": {
    width: 200,
    height: 60,
    terminals: [
      { id: "pos-1", type: "positive", label: "1", x: 40, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-2", type: "positive", label: "2", x: 60, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-3", type: "positive", label: "3", x: 80, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-4", type: "positive", label: "4", x: 100, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-5", type: "positive", label: "5", x: 120, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-6", type: "positive", label: "6", x: 140, y: 30, color: "hsl(var(--wire-positive))", orientation: "bottom" },
    ],
  },

  "busbar-negative": {
    width: 200,
    height: 60,
    terminals: [
      { id: "neg-1", type: "negative", label: "1", x: 40, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-2", type: "negative", label: "2", x: 60, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-3", type: "negative", label: "3", x: 80, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-4", type: "negative", label: "4", x: 100, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-5", type: "negative", label: "5", x: 120, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-6", type: "negative", label: "6", x: 140, y: 30, color: "hsl(var(--wire-negative))", orientation: "bottom" },
    ],
  },
};

export const TERMINAL_CONFIGS_EXTENDED: Record<string, ComponentTerminalConfig> = {
  inverter: {
    width: 160,
    height: 120,
    terminals: [
      { id: "dc-positive", type: "positive", label: "DC+", x: 19, y: 60, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 19, y: 80, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "ac-out-hot", type: "ac-out", label: "AC L", x: 149, y: 50, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "ac-out-neutral", type: "ac-out", label: "AC N", x: 149, y: 70, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "ac-out-ground", type: "ground", label: "AC G", x: 149, y: 90, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
    ],
  },

  fuse: {
    width: 80,
    height: 60,
    terminals: [
      { id: "in", type: "positive", label: "IN", x: 8, y: 30, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "out", type: "positive", label: "OUT", x: 72, y: 30, color: "hsl(var(--wire-positive))", orientation: "right" },
    ],
  },

  // DC circuit breaker: resettable protection for a branch circuit (DC panel
  // feed, MPPT, windlass). Doubles as a disconnect switch.
  "dc-breaker": {
    width: 80,
    height: 80,
    terminals: [
      { id: "in", type: "positive", label: "IN", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "out", type: "positive", label: "OUT", x: 72, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
    ],
  },

  // AC circuit breaker: shore power main, or a branch breaker ahead of an
  // AC load. Neutral and ground pass through unswitched.
  "ac-breaker": {
    width: 100,
    height: 100,
    terminals: [
      { id: "in-hot", type: "ac-in", label: "L IN", x: 8, y: 30, color: "hsl(var(--wire-ac-hot))", orientation: "left" },
      { id: "in-neutral", type: "ac-in", label: "N IN", x: 8, y: 50, color: "hsl(var(--wire-neutral))", orientation: "left" },
      { id: "in-ground", type: "ground", label: "G IN", x: 8, y: 70, color: "hsl(var(--wire-ac-ground))", orientation: "left" },
      { id: "out-hot", type: "ac-out", label: "L OUT", x: 92, y: 30, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "out-neutral", type: "ac-out", label: "N OUT", x: 92, y: 50, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "out-ground", type: "ground", label: "G OUT", x: 92, y: 70, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
    ],
  },

  switch: {
    width: 80,
    height: 80,
    terminals: [
      { id: "in", type: "positive", label: "IN", x: -8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "out", type: "positive", label: "OUT", x: 88, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
    ],
  },

  "ac-panel": {
    width: 180,
    height: 220,
    terminals: [
      { id: "main-in-hot", type: "ac-in", label: "MAIN L", x: 20, y: 217, color: "hsl(var(--wire-ac-hot))", orientation: "bottom" },
      { id: "main-in-neutral", type: "ac-in", label: "MAIN N", x: 90, y: 217, color: "hsl(var(--wire-neutral))", orientation: "bottom" },
      { id: "main-in-ground", type: "ground", label: "MAIN G", x: 160, y: 217, color: "hsl(var(--wire-ac-ground))", orientation: "bottom" },

      { id: "load-1-hot", type: "ac-out", label: "L1", x: 177, y: 40, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "load-1-neutral", type: "ac-out", label: "N1", x: 177, y: 60, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "load-1-ground", type: "ground", label: "G1", x: 177, y: 80, color: "hsl(var(--wire-ac-ground))", orientation: "right" },

      { id: "load-2-hot", type: "ac-out", label: "L2", x: 177, y: 120, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "load-2-neutral", type: "ac-out", label: "N2", x: 177, y: 140, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "load-2-ground", type: "ground", label: "G2", x: 177, y: 160, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
    ],
  },

  "dc-panel": {
    width: 160,
    height: 240,
    terminals: [
      { id: "main-in-pos", type: "positive", label: "MAIN+", x: 40, y: 237, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "main-in-neg", type: "negative", label: "MAIN-", x: 120, y: 237, color: "hsl(var(--wire-negative))", orientation: "bottom" },

      { id: "load-1-pos", type: "positive", label: "1+", x: 157, y: 40, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "load-1-neg", type: "negative", label: "1-", x: 157, y: 60, color: "hsl(var(--wire-negative))", orientation: "right" },

      { id: "load-2-pos", type: "positive", label: "2+", x: 157, y: 100, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "load-2-neg", type: "negative", label: "2-", x: 157, y: 120, color: "hsl(var(--wire-negative))", orientation: "right" },

      { id: "load-3-pos", type: "positive", label: "3+", x: 157, y: 160, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "load-3-neg", type: "negative", label: "3-", x: 157, y: 180, color: "hsl(var(--wire-negative))", orientation: "right" },
    ],
  },

  "shore-power": {
    width: 140,
    height: 100,
    terminals: [
      { id: "ac-out-hot", type: "ac-out", label: "L", x: 132, y: 25, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "ac-out-neutral", type: "ac-out", label: "N", x: 132, y: 50, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "ac-out-ground", type: "ground", label: "G", x: 132, y: 75, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
    ],
  },

  alternator: {
    width: 140,
    height: 120,
    terminals: [
      { id: "output-positive", type: "positive", label: "B+", x: 132, y: 50, color: "hsl(var(--wire-positive))", orientation: "right" },
      { id: "output-negative", type: "negative", label: "B-", x: 132, y: 70, color: "hsl(var(--wire-negative))", orientation: "right" },
    ],
  },

  "transfer-switch": {
    width: 180,
    height: 140,
    terminals: [
      { id: "source1-hot", type: "ac-in", label: "S1 L", x: 60, y: 20, color: "hsl(var(--wire-ac-hot))", orientation: "top" },
      { id: "source1-neutral", type: "ac-in", label: "S1 N", x: 90, y: 20, color: "hsl(var(--wire-neutral))", orientation: "top" },
      { id: "source1-ground", type: "ground", label: "S1 G", x: 120, y: 20, color: "hsl(var(--wire-ac-ground))", orientation: "top" },
      { id: "source2-hot", type: "ac-in", label: "S2 L", x: 8, y: 50, color: "hsl(var(--wire-ac-hot))", orientation: "left" },
      { id: "source2-neutral", type: "ac-in", label: "S2 N", x: 8, y: 70, color: "hsl(var(--wire-neutral))", orientation: "left" },
      { id: "source2-ground", type: "ground", label: "S2 G", x: 8, y: 90, color: "hsl(var(--wire-ac-ground))", orientation: "left" },
      { id: "output-hot", type: "ac-out", label: "OUT L", x: 172, y: 50, color: "hsl(var(--wire-ac-hot))", orientation: "right" },
      { id: "output-neutral", type: "ac-out", label: "OUT N", x: 172, y: 70, color: "hsl(var(--wire-neutral))", orientation: "right" },
      { id: "output-ground", type: "ground", label: "OUT G", x: 172, y: 90, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
    ],
  },
};

Object.assign(TERMINAL_CONFIGS, TERMINAL_CONFIGS_EXTENDED);

/**
 * MPPT models that ship with a LOAD output (low-voltage-disconnect terminals
 * for small DC loads). Only the compact 75V/100V units have them; the larger
 * 150V and 250V units do not.
 */
const MPPT_MODELS_WITH_LOAD_OUTPUT = new Set(["75|10", "75|15", "100|15", "100|20"]);

const MPPT_LOAD_TERMINALS: Terminal[] = [
  { id: "load-positive", type: "positive", label: "LOAD+", x: 152, y: 60, color: "hsl(var(--wire-positive))", orientation: "right" },
  { id: "load-negative", type: "negative", label: "LOAD-", x: 152, y: 80, color: "hsl(var(--wire-negative))", orientation: "right" },
];

/** True when this MPPT instance is a model with LOAD output terminals. */
export function mpptHasLoadOutput(properties?: Record<string, any> | null): boolean {
  const model = properties?.model;
  return typeof model === "string" && MPPT_MODELS_WITH_LOAD_OUTPUT.has(model);
}

/**
 * Component orientation.
 *
 * Rotation is in 90-degree steps only. The wire router is orthogonal and each
 * terminal declares which edge it exits from, so arbitrary angles would leave
 * "left"/"top" meaningless; quarter turns keep both the router and the 20px
 * grid valid. Mirroring flips the body without rotating it, which is what you
 * want for a busbar feeding the other way.
 */
export type Rotation = 0 | 90 | 180 | 270;

export interface Orientation {
  rotation: Rotation;
  mirrorX: boolean;
  mirrorY: boolean;
}

export const DEFAULT_ORIENTATION: Orientation = { rotation: 0, mirrorX: false, mirrorY: false };

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/** Read orientation off a component's properties, tolerating older saves. */
export function getOrientation(properties?: Record<string, any> | null): Orientation {
  const raw = Number(properties?.rotation ?? 0);
  const rotation = (ROTATIONS as number[]).includes(raw) ? (raw as Rotation) : 0;
  return {
    rotation,
    mirrorX: !!properties?.mirrorX,
    mirrorY: !!properties?.mirrorY,
  };
}

/** True when the component is left in its default orientation. */
export function isDefaultOrientation(o: Orientation): boolean {
  return o.rotation === 0 && !o.mirrorX && !o.mirrorY;
}

const MIRROR_X_EDGE: Record<TerminalOrientation, TerminalOrientation> = {
  left: "right", right: "left", top: "top", bottom: "bottom",
};
const MIRROR_Y_EDGE: Record<TerminalOrientation, TerminalOrientation> = {
  top: "bottom", bottom: "top", left: "left", right: "right",
};
// A quarter turn clockwise moves the left edge to the top, the top to the
// right, and so on.
const ROTATE_EDGE_CW: Record<TerminalOrientation, TerminalOrientation> = {
  left: "top", top: "right", right: "bottom", bottom: "left",
};

function rotateEdge(edge: TerminalOrientation, rotation: Rotation): TerminalOrientation {
  let e = edge;
  for (let i = 0; i < rotation / 90; i++) e = ROTATE_EDGE_CW[e];
  return e;
}

/**
 * Map a terminal from the component's own (unrotated) coordinate space into
 * the space it actually occupies on the canvas.
 *
 * Mirroring is applied first, in the body's own frame, then the rotation - so
 * "flip it, then turn it" behaves the way it reads.
 */
export function transformTerminal(
  terminal: Terminal,
  baseWidth: number,
  baseHeight: number,
  o: Orientation
): Terminal {
  let { x, y } = terminal;
  let edge = terminal.orientation;

  if (o.mirrorX) {
    x = baseWidth - x;
    edge = MIRROR_X_EDGE[edge];
  }
  if (o.mirrorY) {
    y = baseHeight - y;
    edge = MIRROR_Y_EDGE[edge];
  }

  switch (o.rotation) {
    case 90:
      [x, y] = [baseHeight - y, x];
      break;
    case 180:
      [x, y] = [baseWidth - x, baseHeight - y];
      break;
    case 270:
      [x, y] = [y, baseWidth - x];
      break;
  }

  return { ...terminal, x, y, orientation: rotateEdge(edge, o.rotation) };
}

/** A quarter turn swaps the footprint's width and height. */
export function transformDimensions(
  width: number,
  height: number,
  o: Orientation
): { width: number; height: number } {
  return o.rotation === 90 || o.rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * CSS custom properties that cancel a component's transform for its text.
 *
 * A mirrored component reads backwards and a 180-degree one reads upside down;
 * neither is ever correct on a schematic. Cancelling the transform on the text
 * nodes alone keeps the symbol flipped while the labels stay legible.
 *
 * Quarter turns are left alone on purpose: sideways text is conventional and
 * readable, and standing it upright would push labels out of a box that just
 * became narrower.
 */
export function getLabelCounterTransform(o: Orientation): Record<string, string> {
  return {
    "--label-flip-x": o.mirrorX ? "-1" : "1",
    "--label-flip-y": o.mirrorY ? "-1" : "1",
    "--label-rotate": o.rotation === 180 ? "180deg" : "0deg",
  };
}

/**
 * Terminals for a component instance. Most components have a fixed terminal
 * set keyed by type, but some (MPPT LOAD output) vary by the selected model,
 * so pass the component's properties when they are available.
 *
 * "custom" components (see docs/custom-components-design.md) snapshot their
 * own terminal list into `properties.terminals` when placed on the canvas -
 * when present, that snapshot is authoritative and takes over from the fixed
 * 4-terminal fallback in TERMINAL_CONFIGS.custom.
 */
export function getComponentTerminals(
  componentType: string,
  properties?: Record<string, any> | null
): Terminal[] {
  if (
    componentType === "custom" &&
    properties &&
    Array.isArray(properties.terminals) &&
    properties.terminals.length > 0
  ) {
    return applyOrientation(
      properties.terminals as Terminal[],
      Number(properties.width) || 160,
      Number(properties.height) || 120,
      properties
    );
  }

  const config = TERMINAL_CONFIGS[componentType];
  if (!config) return [];

  const base =
    componentType === "mppt" && mpptHasLoadOutput(properties)
      ? [...config.terminals, ...MPPT_LOAD_TERMINALS]
      : config.terminals;

  return applyOrientation(base, config.width, config.height, properties);
}

/**
 * Apply the instance's rotation/mirroring to a terminal list. Everything that
 * resolves terminals goes through getComponentTerminals, so doing it here
 * means routing, hit testing, validation and export all see rotated geometry
 * without each having to know about it.
 */
function applyOrientation(
  terminals: Terminal[],
  baseWidth: number,
  baseHeight: number,
  properties?: Record<string, any> | null
): Terminal[] {
  const o = getOrientation(properties);
  if (isDefaultOrientation(o)) return terminals;
  return terminals.map(t => transformTerminal(t, baseWidth, baseHeight, o));
}

/**
 * Rendered width/height for a component instance. Custom components snapshot
 * their own dimensions into `properties.width`/`properties.height` at
 * placement time, just like their terminal list - everything else uses the
 * fixed per-type size in TERMINAL_CONFIGS. Falls back to a generic 120x100
 * box for unknown types, matching the fallback used elsewhere in the app.
 */
export function getComponentDimensions(
  componentType: string,
  properties?: Record<string, any> | null
): { width: number; height: number } {
  const base = getBaseComponentDimensions(componentType, properties);
  return transformDimensions(base.width, base.height, getOrientation(properties));
}

/**
 * The component's own size before rotation. Only the renderer needs this: it
 * draws the artwork at its natural size and rotates it with a transform,
 * while everything else works with the rotated footprint.
 */
export function getBaseComponentDimensions(
  componentType: string,
  properties?: Record<string, any> | null
): { width: number; height: number } {
  if (
    componentType === "custom" &&
    properties &&
    typeof properties.width === "number" &&
    typeof properties.height === "number"
  ) {
    return { width: properties.width, height: properties.height };
  }

  const config = TERMINAL_CONFIGS[componentType];
  return config ? { width: config.width, height: config.height } : { width: 120, height: 100 };
}

// Helper function to get terminal absolute position on canvas
export function getTerminalPosition(
  componentX: number,
  componentY: number,
  componentType: string,
  terminalId: string,
  properties?: Record<string, any> | null
): { x: number; y: number } | null {
  const terminal = getComponentTerminals(componentType, properties).find(t => t.id === terminalId);
  if (!terminal) return null;

  // Grid size for snapping (must match wire-routing.ts)
  const GRID_SIZE = 20;

  // Calculate terminal position and snap to grid
  const rawX = componentX + terminal.x;
  const rawY = componentY + terminal.y;

  return {
    x: Math.round(rawX / GRID_SIZE) * GRID_SIZE,
    y: Math.round(rawY / GRID_SIZE) * GRID_SIZE,
  };
}

// Helper function to get terminal orientation
export function getTerminalOrientation(
  componentType: string,
  terminalId: string,
  properties?: Record<string, any> | null
): TerminalOrientation | null {
  const terminal = getComponentTerminals(componentType, properties).find(t => t.id === terminalId);
  return terminal ? terminal.orientation : null;
}

// Helper function to find the closest terminal to a click position
export function findClosestTerminal(
  componentX: number,
  componentY: number,
  componentType: string,
  clickX: number,
  clickY: number,
  maxDistance: number = 20,
  properties?: Record<string, any> | null
): Terminal | null {
  let closestTerminal: Terminal | null = null;
  let closestDistance = maxDistance;

  for (const terminal of getComponentTerminals(componentType, properties)) {
    const termX = componentX + terminal.x;
    const termY = componentY + terminal.y;
    const distance = Math.sqrt((clickX - termX) ** 2 + (clickY - termY) ** 2);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestTerminal = terminal;
    }
  }

  return closestTerminal;
}
