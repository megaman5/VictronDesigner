export interface Terminal {
  id: string;
  type: "positive" | "negative" | "ground" | "ac-in" | "ac-out" | "pv-positive" | "pv-negative";
  label: string;
  x: number; // Relative to component's top-left corner
  y: number; // Relative to component's top-left corner
  color: string;
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
      { id: "ac-in", type: "ac-in", label: "AC IN", x: 40, y: 110, color: "hsl(var(--wire-neutral))" },
      { id: "ac-out", type: "ac-out", label: "AC OUT", x: 90, y: 110, color: "hsl(var(--wire-neutral))" },
      { id: "dc-positive", type: "positive", label: "DC+", x: 125, y: 110, color: "hsl(var(--wire-positive))" },
      { id: "dc-negative", type: "negative", label: "DC-", x: 155, y: 110, color: "hsl(var(--wire-negative))" },
    ],
  },
  
  mppt: {
    width: 160,
    height: 130,
    terminals: [
      { id: "pv-positive", type: "pv-positive", label: "PV+", x: 30, y: 108, color: "hsl(var(--wire-positive))" },
      { id: "pv-negative", type: "pv-negative", label: "PV-", x: 50, y: 108, color: "hsl(var(--wire-negative))" },
      { id: "batt-positive", type: "positive", label: "BATT+", x: 110, y: 108, color: "hsl(var(--wire-positive))" },
      { id: "batt-negative", type: "negative", label: "BATT-", x: 130, y: 108, color: "hsl(var(--wire-negative))" },
    ],
  },
  
  cerbo: {
    width: 180,
    height: 120,
    terminals: [
      { id: "data-1", type: "ground", label: "VE.Bus", x: 164, y: 33, color: "hsl(var(--muted))" },
      { id: "data-2", type: "ground", label: "VE.Direct", x: 164, y: 48, color: "hsl(var(--muted))" },
      { id: "data-3", type: "ground", label: "CAN", x: 164, y: 63, color: "hsl(var(--muted))" },
      { id: "power", type: "positive", label: "12V", x: 164, y: 78, color: "hsl(var(--wire-positive))" },
    ],
  },
  
  bmv: {
    width: 140,
    height: 140,
    terminals: [
      { id: "data", type: "ground", label: "VE.Direct", x: 130, y: 59, color: "hsl(var(--muted))" },
    ],
  },
  
  battery: {
    width: 160,
    height: 110,
    terminals: [
      { id: "negative", type: "negative", label: "-", x: 10, y: 60, color: "hsl(var(--wire-negative))" },
      { id: "positive", type: "positive", label: "+", x: 150, y: 60, color: "hsl(var(--wire-positive))" },
    ],
  },
  
  "solar-panel": {
    width: 140,
    height: 120,
    terminals: [
      { id: "positive", type: "pv-positive", label: "+", x: 60, y: 100, color: "hsl(var(--wire-positive))" },
      { id: "negative", type: "pv-negative", label: "-", x: 80, y: 100, color: "hsl(var(--wire-negative))" },
    ],
  },
  
  "ac-load": {
    width: 120,
    height: 100,
    terminals: [
      { id: "ac-in", type: "ac-in", label: "AC", x: 17, y: 52, color: "hsl(var(--wire-neutral))" },
    ],
  },
  
  "dc-load": {
    width: 120,
    height: 100,
    terminals: [
      { id: "positive", type: "positive", label: "+", x: 10, y: 52, color: "hsl(var(--wire-positive))" },
      { id: "negative", type: "negative", label: "-", x: 22, y: 52, color: "hsl(var(--wire-negative))" },
    ],
  },
  
  smartshunt: {
    width: 140,
    height: 130,
    terminals: [
      { id: "negative", type: "negative", label: "BATT-", x: 20, y: 105, color: "hsl(var(--wire-negative))" },
      { id: "system-minus", type: "negative", label: "SYS-", x: 70, y: 105, color: "hsl(var(--wire-negative))" },
      { id: "data", type: "ground", label: "VE.Direct", x: 120, y: 105, color: "hsl(var(--muted))" },
    ],
  },
};

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
  
  return {
    x: componentX + terminal.x,
    y: componentY + terminal.y,
  };
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
