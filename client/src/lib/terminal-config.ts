export type TerminalOrientation = "left" | "right" | "top" | "bottom";

export interface Terminal {
  id: string;
  type: "positive" | "negative" | "ground" | "ac-in" | "ac-out" | "pv-positive" | "pv-negative";
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
      { id: "chassis-ground", type: "ground", label: "GND", x: 188, y: 70, color: "hsl(var(--wire-ac-ground))", orientation: "right" },
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

  "lynx-distributor": {
    width: 220,
    height: 100,
    terminals: [
      { id: "main-positive", type: "positive", label: "BUS+", x: 8, y: 40, color: "hsl(var(--wire-positive))", orientation: "left" },
      { id: "main-negative", type: "negative", label: "BUS-", x: 8, y: 60, color: "hsl(var(--wire-negative))", orientation: "left" },
      { id: "fuse-1", type: "positive", label: "F1", x: 60, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-2", type: "positive", label: "F2", x: 100, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-3", type: "positive", label: "F3", x: 140, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "fuse-4", type: "positive", label: "F4", x: 180, y: 92, color: "hsl(var(--wire-positive))", orientation: "bottom" },
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
      { id: "pos-1", type: "positive", label: "1", x: 40, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-2", type: "positive", label: "2", x: 60, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-3", type: "positive", label: "3", x: 80, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-4", type: "positive", label: "4", x: 100, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-5", type: "positive", label: "5", x: 120, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
      { id: "pos-6", type: "positive", label: "6", x: 140, y: 40, color: "hsl(var(--wire-positive))", orientation: "bottom" },
    ],
  },

  "busbar-negative": {
    width: 200,
    height: 60,
    terminals: [
      { id: "neg-1", type: "negative", label: "1", x: 40, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-2", type: "negative", label: "2", x: 60, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-3", type: "negative", label: "3", x: 80, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-4", type: "negative", label: "4", x: 100, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-5", type: "negative", label: "5", x: 120, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
      { id: "neg-6", type: "negative", label: "6", x: 140, y: 40, color: "hsl(var(--wire-negative))", orientation: "bottom" },
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

// Helper function to get terminal absolute position on canvas
export function getTerminalPosition(
  componentX: number,
  componentY: number,
  componentType: string,
  terminalId: string
): { x: number; y: number } | null {
  const config = TERMINAL_CONFIGS[componentType];
  if (!config) return null;

  const terminal = config.terminals.find(t => t.id === terminalId);
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
  terminalId: string
): TerminalOrientation | null {
  const config = TERMINAL_CONFIGS[componentType];
  if (!config) return null;

  const terminal = config.terminals.find(t => t.id === terminalId);
  if (!terminal) return null;

  return terminal.orientation;
}

// Helper function to find the closest terminal to a click position
export function findClosestTerminal(
  componentX: number,
  componentY: number,
  componentType: string,
  clickX: number,
  clickY: number,
  maxDistance: number = 20
): Terminal | null {
  const config = TERMINAL_CONFIGS[componentType];
  if (!config) return null;

  let closestTerminal: Terminal | null = null;
  let closestDistance = maxDistance;

  for (const terminal of config.terminals) {
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
