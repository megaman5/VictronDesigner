import { getACVoltage, getInverterACVoltage } from "@shared/ac-voltage";
import type { WireCalculation } from "@shared/schema";

export type InsulationType = "60C" | "75C" | "90C" | "105C";

// Wire gauge data based on ABYC E-11 (marine) standards
// Resistance in ohms per 1000 feet at 75°C for copper
// Ampacity from ABYC E-11 Table VI: single conductor in free air,
// 30°C ambient, outside engine spaces. Marine cable (UL 1426, e.g.
// Victron battery cable) is typically 105°C rated.
const WIRE_DATA = {
  "4/0": { resistance: 0.0490, ampacity60C: 300, ampacity75C: 360, ampacity90C: 385, ampacity105C: 445 },
  "3/0": { resistance: 0.0618, ampacity60C: 260, ampacity75C: 310, ampacity90C: 330, ampacity105C: 385 },
  "2/0": { resistance: 0.0779, ampacity60C: 225, ampacity75C: 265, ampacity90C: 285, ampacity105C: 330 },
  "1/0": { resistance: 0.0983, ampacity60C: 195, ampacity75C: 230, ampacity90C: 245, ampacity105C: 285 },
  "1": { resistance: 0.1240, ampacity60C: 165, ampacity75C: 195, ampacity90C: 210, ampacity105C: 245 },
  "2": { resistance: 0.1563, ampacity60C: 140, ampacity75C: 170, ampacity90C: 180, ampacity105C: 210 },
  "4": { resistance: 0.2485, ampacity60C: 105, ampacity75C: 125, ampacity90C: 135, ampacity105C: 160 },
  "6": { resistance: 0.3951, ampacity60C: 80, ampacity75C: 95, ampacity90C: 100, ampacity105C: 120 },
  "8": { resistance: 0.6282, ampacity60C: 55, ampacity75C: 65, ampacity90C: 70, ampacity105C: 80 },
  "10": { resistance: 0.9989, ampacity60C: 40, ampacity75C: 40, ampacity90C: 55, ampacity105C: 60 },
  "12": { resistance: 1.588, ampacity60C: 25, ampacity75C: 25, ampacity90C: 40, ampacity105C: 45 },
  "14": { resistance: 2.525, ampacity60C: 20, ampacity75C: 20, ampacity90C: 30, ampacity105C: 35 },
  "16": { resistance: 4.016, ampacity60C: 15, ampacity75C: 15, ampacity90C: 25, ampacity105C: 25 },
  "18": { resistance: 6.385, ampacity60C: 10, ampacity75C: 10, ampacity90C: 20, ampacity105C: 20 },
};

export type WireGaugeFormat = "awg" | "metric";

const AWG_TO_MM2: Record<string, number> = {
  "4/0": 107,
  "3/0": 85,
  "2/0": 67.4,
  "1/0": 53.5,
  "1": 42.4,
  "2": 33.6,
  "4": 21.2,
  "6": 13.3,
  "8": 8.37,
  "10": 5.26,
  "12": 3.31,
  "14": 2.08,
  "16": 1.31,
  "18": 0.823,
};

/**
 * A metric size ("6 mm2", "6mm²") as the largest AWG size whose area does not
 * exceed it, so a metric cable is never credited with more capacity than it
 * has (6 mm² is rated as 10 AWG, 5.26 mm²). AI designs sometimes store metric
 * sizes even though gauges are stored in AWG; they were "unrecognized".
 */
export function metricToAwgGauge(gauge: string): string | undefined {
  const m = gauge.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:mm2|mm²|mm\^2|sq\s*mm)$/i);
  if (!m) return undefined;
  const area = Number(m[1].replace(",", "."));
  const fit = Object.entries(AWG_TO_MM2).filter(([, mm2]) => mm2 <= area * 1.001).sort((x, y) => y[1] - x[1])[0];
  return fit?.[0];
}

function normalizeGauge(gauge: string): string {
  // "3x2.5mm2 (14 AWG)": the AWG size in brackets is the one to rate.
  const bracketed = gauge.match(/\(\s*(\d\/0|\d+)\s*AWG\s*\)/i);
  if (bracketed) return bracketed[1];
  const metric = metricToAwgGauge(gauge.replace(/^\s*\d+\s*[x×]\s*/i, ""));
  if (metric) return metric;
  return gauge.replace(" AWG", "").trim().replace(/\\0/g, "/0");
}

/** Stored wire size, shared by display and illustrative cable geometry. */
export function wireGaugeAreaMm2(gauge: string | undefined): number | undefined {
  if (!gauge) return undefined;
  return AWG_TO_MM2[normalizeGauge(gauge.toUpperCase())];
}

function formatMetricArea(mm2: number): string {
  return mm2 >= 10 ? mm2.toFixed(1).replace(/\.0$/, "") : mm2.toFixed(2).replace(/0$/, "");
}

export function formatWireGauge(gauge: string | undefined, format: WireGaugeFormat = "awg"): string {
  if (!gauge) return "";

  const normalizedGauge = normalizeGauge(gauge);
  const mm2 = AWG_TO_MM2[normalizedGauge];
  if (!mm2) return gauge;

  if (format === "metric") {
    return `${formatMetricArea(mm2)} mm²`;
  }

  return `${normalizedGauge} AWG`;
}

// Wire length is stored internally in feet everywhere (schema, wire routing,
// server-side ABYC/NEC calculations). LengthUnit only controls display/entry.
export type LengthUnit = "ft" | "m";

const FEET_PER_METER = 3.28084;

export function feetToDisplayLength(feet: number, unit: LengthUnit): number {
  return unit === "m" ? feet / FEET_PER_METER : feet;
}

export function displayLengthToFeet(value: number, unit: LengthUnit): number {
  return unit === "m" ? value * FEET_PER_METER : value;
}

export function formatWireLength(feet: number | null | undefined, unit: LengthUnit = "ft"): string {
  if (feet == null) return "";
  const value = feetToDisplayLength(feet, unit);
  return `${value.toFixed(1)}${unit}`;
}

export function lengthUnitLabel(unit: LengthUnit): string {
  return unit === "m" ? "m" : "ft";
}



// ABYC ampacity ratings assume 30°C ambient. For hotter locations apply
// the standard correction sqrt((Trated - Tambient) / (Trated - 30)).
// This reproduces the published ABYC/NEC correction tables — e.g. for
// 105°C wire at 50°C (ABYC engine-space ambient) it gives 0.86, matching
// ABYC's 0.85 engine-space factor.
function getTemperatureDerating(tempC: number, insulationType: InsulationType = "105C"): number {
  const ratedTemp = parseInt(insulationType, 10);
  if (tempC >= ratedTemp) return 0;
  if (tempC <= 30) return 1.0;
  return Math.sqrt((ratedTemp - tempC) / (ratedTemp - 30));
}

function getAmpacity(gauge: string, insulationType: InsulationType): number {
  const data = WIRE_DATA[gauge as keyof typeof WIRE_DATA];
  if (!data) return 0;

  switch (insulationType) {
    case "60C": return data.ampacity60C;
    case "75C": return data.ampacity75C;
    case "90C": return data.ampacity90C;
    case "105C": return data.ampacity105C;
    default: return data.ampacity105C;
  }
}

// Export function to get wire ampacity for validation
export function getWireAmpacity(gauge: string, insulationType: InsulationType = "105C", temperatureC: number = 30, bundlingFactor: number = 1.0): number {
  const baseAmpacity = getAmpacity(normalizeGauge(gauge.toUpperCase()), insulationType);
  if (baseAmpacity === 0) return 0;

  const tempDeratingFactor = getTemperatureDerating(temperatureC, insulationType);
  return baseAmpacity * tempDeratingFactor * bundlingFactor;
}

/** Evaluate a selected copper conductor without replacing the manual gauge. */
export function evaluateWireGauge(gauge: string, params: {
  current: number; length: number; voltage: number; insulationType?: InsulationType;
  temperatureC?: number; bundlingFactor?: number;
}): { ampacityA: number; voltageDropV: number; voltageDropPercent: number } | undefined {
  const data = WIRE_DATA[normalizeGauge(gauge.toUpperCase()) as keyof typeof WIRE_DATA];
  if (!data || !Number.isFinite(params.current) || params.current < 0 || !Number.isFinite(params.length) || params.length < 0 || !Number.isFinite(params.voltage) || params.voltage <= 0) return undefined;
  const voltageDropV = 2 * params.current * data.resistance / 1000 * params.length;
  return { ampacityA: getWireAmpacity(gauge, params.insulationType, params.temperatureC, params.bundlingFactor), voltageDropV, voltageDropPercent: voltageDropV / params.voltage * 100 };
}

/** Resistance of ONE copper conductor of this gauge and one-way length (ohms). */
export function conductorResistanceOhms(gauge: string | undefined, lengthFt: number | undefined): number | undefined {
  const data = gauge ? WIRE_DATA[normalizeGauge(gauge.toUpperCase()) as keyof typeof WIRE_DATA] : undefined;
  if (!data || typeof lengthFt !== "number" || !Number.isFinite(lengthFt) || lengthFt <= 0) return undefined;
  return data.resistance / 1000 * lengthFt;
}

/**
 * Compare two wire gauges - returns true if gauge1 >= gauge2 (gauge1 is same size or larger/thicker)
 * AWG sizes: 18 < 16 < 14 < 12 < 10 < 8 < 6 < 4 < 2 < 1 < 1/0 < 2/0 < 3/0 < 4/0
 * In gaugeOrder array: lower index = thinner wire, higher index = thicker wire
 */
function compareGaugeSizes(gauge1: string, gauge2: string): boolean {
  const gaugeOrder = ["18", "16", "14", "12", "10", "8", "6", "4", "2", "1", "1/0", "2/0", "3/0", "4/0"];
  const index1 = gaugeOrder.indexOf(gauge1);
  const index2 = gaugeOrder.indexOf(gauge2);
  
  // If either gauge not found, return false (can't compare)
  if (index1 === -1 || index2 === -1) return false;
  
  // Higher index = thicker wire, so gauge1 >= gauge2 if index1 >= index2
  // (gauge1 is same or thicker than gauge2)
  return index1 >= index2;
}

export function calculateWireSize(params: {
  current: number;
  length: number;
  voltage: number;
  temperatureC?: number;
  conductorMaterial?: "copper" | "aluminum";
  insulationType?: InsulationType;
  bundlingFactor?: number;
  maxVoltageDrop?: number;
  currentGauge?: string; // Optional: current wire gauge - will never recommend smaller
}): WireCalculation {
  const {
    current,
    length,
    voltage,
    temperatureC = 30,
    conductorMaterial = "copper",
    insulationType = "105C",
    bundlingFactor = 1.0,
    maxVoltageDrop = 3.0, // 3% per ABYC standard
    currentGauge,
  } = params;
  
  // Normalize current gauge (remove " AWG" suffix if present)
  const normalizedCurrentGauge = currentGauge ? normalizeGauge(currentGauge.toUpperCase()) : undefined;

  const invalidInput = !Number.isFinite(current) || current < 0 || !Number.isFinite(length) || length < 0 || !Number.isFinite(voltage) || voltage <= 0 || !Number.isFinite(temperatureC) || !Number.isFinite(bundlingFactor) || bundlingFactor <= 0 || !Number.isFinite(maxVoltageDrop) || maxVoltageDrop <= 0;
  if (invalidInput || conductorMaterial !== "copper" || (normalizedCurrentGauge && !WIRE_DATA[normalizedCurrentGauge as keyof typeof WIRE_DATA])) {
    return {
      current, length, voltage, temperatureC, conductorMaterial, insulationType, bundlingFactor, maxVoltageDrop,
      recommendedGauge: currentGauge ?? "", actualVoltageDrop: 0, voltageDropPercent: 0, status: "error",
      message: invalidInput ? "Set finite nonnegative current and length, positive voltage, bundling factor and voltage-drop limit."
        : conductorMaterial !== "copper" ? "Aluminum conductor sizing is unsupported: only copper resistance and ampacity tables are available."
        : "The selected wire gauge is not recognized.",
    };
  }

  // Calculate maximum allowable voltage drop
  const maxVDropVolts = (voltage * maxVoltageDrop) / 100;

  // Temperature derating factor
  const tempDeratingFactor = getTemperatureDerating(temperatureC, insulationType);

  // Find the smallest gauge that meets both voltage drop and ampacity requirements
  // Sort gauges from smallest to largest (by ampacity/resistance)
  // Order: 18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 1/0, 2/0, 3/0, 4/0
  const gaugeOrder = ["18", "16", "14", "12", "10", "8", "6", "4", "2", "1", "1/0", "2/0", "3/0", "4/0"];
  
  let recommendedGauge = "4/0";
  let actualVoltageDrop = 0;
  let voltageDropPercent = 0;
  let status: "valid" | "warning" | "error" = "valid";
  let message = "";

  // Iterate from smallest to largest to find the smallest gauge that meets requirements
  // BUT: Never recommend a gauge smaller than the current gauge
  for (const gauge of gaugeOrder) {
    const wireData = WIRE_DATA[gauge as keyof typeof WIRE_DATA];
    if (!wireData) continue;
    
    // If we have a current gauge, skip any gauges smaller than it
    if (normalizedCurrentGauge && !compareGaugeSizes(gauge, normalizedCurrentGauge)) {
      continue; // Skip this gauge - it's smaller than current
    }
    
    // Calculate voltage drop: VD = 2 × I × R × L / 1000
    // (2 for round trip, R is ohms/1000ft, L in feet)
    const resistancePerFoot = wireData.resistance / 1000;
    const vDrop = 2 * current * resistancePerFoot * length;
    const vDropPercent = (vDrop / voltage) * 100;

    // Get ampacity with derating
    const baseAmpacity = getAmpacity(gauge, insulationType);
    const deratedAmpacity = baseAmpacity * tempDeratingFactor * bundlingFactor;

    // Check if this gauge meets requirements
    if (vDrop <= maxVDropVolts && current <= deratedAmpacity) {
      recommendedGauge = gauge;
      actualVoltageDrop = vDrop;
      voltageDropPercent = vDropPercent;

      // Set status based on how close we are to limits
      if (vDropPercent > maxVoltageDrop * 0.9 || current > deratedAmpacity * 0.9) {
        status = "warning";
        message = "Wire size is near maximum capacity. Consider larger gauge.";
      } else {
        status = "valid";
        message = "Wire size meets ABYC E-11 marine standards.";
      }
      break; // Found the smallest gauge that works (and is >= current gauge)
    }
  }

  // If no gauge is sufficient, use the largest and mark as invalid
  if (recommendedGauge === "4/0") {
    const wireData = WIRE_DATA["4/0"];
    const resistancePerFoot = wireData.resistance / 1000;
    actualVoltageDrop = 2 * current * resistancePerFoot * length;
    voltageDropPercent = (actualVoltageDrop / voltage) * 100;

    const baseAmpacity = getAmpacity("4/0", insulationType);
    const deratedAmpacity = baseAmpacity * tempDeratingFactor * bundlingFactor;

    if (actualVoltageDrop > maxVDropVolts || current > deratedAmpacity) {
      status = "error";
      if (actualVoltageDrop > maxVDropVolts) {
        message = `Voltage drop (${voltageDropPercent.toFixed(1)}%) exceeds ${maxVoltageDrop}% limit. Run may be too long.`;
      } else {
        // Calculate how many parallel runs of 4/0 AWG are needed
        const parallelRunsNeeded = Math.ceil(current / deratedAmpacity);
        message = `Current (${current.toFixed(1)}A) exceeds maximum ampacity (${deratedAmpacity.toFixed(0)}A). Use ${parallelRunsNeeded} parallel run(s) of 4/0 AWG or reduce current.`;
      }
    }
  }

  return {
    current,
    length,
    voltage,
    temperatureC,
    conductorMaterial,
    insulationType,
    bundlingFactor,
    maxVoltageDrop,
    recommendedGauge: `${recommendedGauge} AWG`,
    actualVoltageDrop,
    voltageDropPercent,
    status,
    message,
  };
}

export function calculateLoadRequirements(components: any[], systemVoltage: number = 12): {
  dcLoads: number;
  acLoads: number;
  totalPower: number;
  peakPower: number;
  averagePower: number;
  batteryCapacityRequired: number;
  inverterSizeRequired: number;
  chargingPowerRequired: number;
} {
  let dcLoads = 0;
  let acLoads = 0;
  let solarPower = 0;

  components.forEach((comp) => {
    const watts = comp.properties?.watts || comp.properties?.power || 0;
    
    if (comp.type === "dc-load") {
      dcLoads += watts;
    } else if (comp.type === "ac-load") {
      acLoads += watts;
    } else if (comp.type === "solar-panel") {
      solarPower += watts;
    }
  });

  const totalPower = dcLoads + acLoads;
  const peakPower = totalPower * 1.25; // 25% safety margin
  const averagePower = totalPower * 0.7; // Assume 70% duty cycle

  const battery = components.find(comp => comp.type === "battery");
  const batteryVoltage = (battery?.properties?.voltage as number | undefined) || systemVoltage || 12;

  // Battery capacity: enough for 24 hours at average load
  // Ah = (Wh per day) / voltage / depth of discharge
  const batteryCapacityRequired = (averagePower * 24) / batteryVoltage / 0.5; // 50% DOD

  // Inverter size: peak AC load + 25% safety margin
  const inverterSizeRequired = acLoads * 1.25;

  // Charging power: replace daily consumption in 5 hours of sun
  const chargingPowerRequired = (averagePower * 24) / 5;

  return {
    dcLoads,
    acLoads,
    totalPower,
    peakPower,
    averagePower,
    batteryCapacityRequired,
    inverterSizeRequired,
    chargingPowerRequired,
  };
}

// AC voltage handling lives in shared/ac-voltage.ts so the client UI, the
// server validator, and this calculator all agree on split-phase behaviour.
export {
  SUPPORTED_AC_VOLTAGES,
  getACVoltage,
  getInverterACVoltage,
  getSupportedACVoltages,
  isSplitPhase,
  type ACOutputConfig,
} from "@shared/ac-voltage";

/**
 * Calculate inverter DC input power and current from connected AC loads
 * @param inverterId - The inverter component ID
 * @param components - All components in the design
 * @param wires - All wires in the design
 * @param systemVoltage - DC system voltage (12V/24V/48V)
 * @param inverterEfficiency - Inverter efficiency (default 0.875 = 87.5%)
 * @returns Object with dcPower (watts) and dcCurrent (amps)
 */
export function calculateInverterDCInput(
  inverterId: string,
  components: any[],
  wires: any[],
  systemVoltage: number,
  inverterEfficiency: number = 0.875
): { 
  acLoadWatts: number; 
  dcInputWatts: number; 
  dcInputCurrent: number; 
  dcCurrent: number; // Alias for backward compatibility
  dcPower: number; // Alias for backward compatibility
  acVoltage: number;
} {
  // Find the inverter component
  const inverter = components.find(c => c.id === inverterId);
  if (!inverter || (inverter.type !== "multiplus" && inverter.type !== "phoenix-inverter" && inverter.type !== "quattro" && inverter.type !== "inverter")) {
    return { 
      acLoadWatts: 0, 
      dcInputWatts: 0, 
      dcInputCurrent: 0, 
      dcCurrent: 0,
      dcPower: 0,
      acVoltage: 120 
    };
  }

  // Find all AC loads connected to this inverter
  // Trace from inverter AC output terminals to AC loads
  const inverterACOutputTerminals = ["ac-out-hot", "ac-out-neutral"];
  let totalACWatts = 0;
  // Start from the inverter's own AC output setting; a connected load that
  // states a different voltage overrides it below.
  let acVoltage = getInverterACVoltage(inverter);

  const countedACLoads = new Set<string>();

  // Helper to find AC loads connected through AC panels
  const findACLoads = (componentId: string, visited: Set<string> = new Set()): { watts: number; voltage: number } => {
    if (visited.has(componentId)) return { watts: 0, voltage: 120 };
    visited.add(componentId);

    const comp = components.find(c => c.id === componentId);
    if (!comp) return { watts: 0, voltage: 120 };

    // If this is an AC load, return its watts and voltage
    if (comp.type === "ac-load") {
      if (countedACLoads.has(comp.id)) return { watts: 0, voltage: 120 };
      countedACLoads.add(comp.id);
      const loadWatts = (comp.properties?.watts || comp.properties?.power || 0) as number;
      const loadVoltage = getACVoltage(comp);
      return { watts: loadWatts, voltage: loadVoltage };
    }

    // If this is an AC panel, trace through to its loads
    if (comp.type === "ac-panel") {
      let panelWatts = 0;
      let panelVoltage = 120;
      const panelWires = wires.filter(
        w => (w.fromComponentId === componentId || w.toComponentId === componentId) &&
             w.polarity === "hot"
      );
      
      const visitedLoads = new Set<string>();
      for (const panelWire of panelWires) {
        const otherCompId = panelWire.fromComponentId === componentId 
          ? panelWire.toComponentId 
          : panelWire.fromComponentId;
        
        if (!visitedLoads.has(otherCompId)) {
          visitedLoads.add(otherCompId);
          const result = findACLoads(otherCompId, new Set(visited));
          panelWatts += result.watts;
          if (result.voltage !== 120) panelVoltage = result.voltage;
        }
      }
      return { watts: panelWatts, voltage: panelVoltage };
    }

    // For other AC components, trace through
    const connectedWires = wires.filter(
      w => (w.fromComponentId === componentId || w.toComponentId === componentId) &&
           (w.polarity === "hot" || w.polarity === "neutral" || w.polarity === "ground")
    );

    for (const connectedWire of connectedWires) {
      const otherCompId = connectedWire.fromComponentId === componentId 
        ? connectedWire.toComponentId 
        : connectedWire.fromComponentId;
      const result = findACLoads(otherCompId, new Set(visited));
      if (result.watts > 0) {
        return result;
      }
    }

    return { watts: 0, voltage: 120 };
  };

  // Find wires connected to inverter AC output terminals
  // Check if wire is connected to inverter and uses AC output terminals
  const inverterACWires = wires.filter(w => {
    const isConnectedToInverter = w.fromComponentId === inverterId || w.toComponentId === inverterId;
    if (!isConnectedToInverter) return false;
    
    // Check if this wire connects to AC output terminals
    const fromTerminalMatch = w.fromComponentId === inverterId && 
                              w.fromTerminal && 
                              inverterACOutputTerminals.includes(w.fromTerminal);
    const toTerminalMatch = w.toComponentId === inverterId && 
                            w.toTerminal && 
                            inverterACOutputTerminals.includes(w.toTerminal);
    
    return fromTerminalMatch || toTerminalMatch;
  });

  const visitedComponents = new Set<string>();
  for (const acWire of inverterACWires) {
    const otherCompId = acWire.fromComponentId === inverterId 
      ? acWire.toComponentId 
      : acWire.fromComponentId;
    
    if (!visitedComponents.has(otherCompId)) {
      visitedComponents.add(otherCompId);
      const result = findACLoads(otherCompId, new Set());
      totalACWatts += result.watts;
      if (result.voltage !== 120) acVoltage = result.voltage;
    }
  }

  // If no AC loads found via tracing, check if inverter has a power rating
  // and assume it's being used at that capacity
  if (totalACWatts === 0) {
    const inverterRating = (inverter.properties?.powerRating || inverter.properties?.watts || inverter.properties?.power || 0) as number;
    if (inverterRating > 0) {
      // Assume 80% utilization
      totalACWatts = inverterRating * 0.8;
    }
  }

  // Calculate DC input power: AC output / efficiency
  const dcInputWatts = totalACWatts / inverterEfficiency;
  
  // Calculate DC current: DC power / DC voltage
  const dcInputCurrent = systemVoltage > 0 ? dcInputWatts / systemVoltage : 0;

  return { 
    acLoadWatts: totalACWatts,
    dcInputWatts,
    dcInputCurrent,
    dcCurrent: dcInputCurrent, // Alias for backward compatibility
    dcPower: dcInputWatts, // Alias for backward compatibility
    acVoltage
  };
}
