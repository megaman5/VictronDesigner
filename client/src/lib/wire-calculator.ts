import type { WireCalculation } from "@shared/schema";

// Wire gauge data based on ABYC/NEC standards
// Resistance in ohms per 1000 feet at 75°C for copper
const WIRE_DATA = {
  "4/0": { resistance: 0.0490, ampacity60C: 195, ampacity75C: 230, ampacity90C: 260 },
  "3/0": { resistance: 0.0618, ampacity60C: 165, ampacity75C: 200, ampacity90C: 225 },
  "2/0": { resistance: 0.0779, ampacity60C: 145, ampacity75C: 175, ampacity90C: 195 },
  "1/0": { resistance: 0.0983, ampacity60C: 125, ampacity75C: 150, ampacity90C: 170 },
  "1": { resistance: 0.1240, ampacity60C: 110, ampacity75C: 130, ampacity90C: 145 },
  "2": { resistance: 0.1563, ampacity60C: 95, ampacity75C: 115, ampacity90C: 130 },
  "4": { resistance: 0.2485, ampacity60C: 70, ampacity75C: 85, ampacity90C: 95 },
  "6": { resistance: 0.3951, ampacity60C: 55, ampacity75C: 65, ampacity90C: 75 },
  "8": { resistance: 0.6282, ampacity60C: 40, ampacity75C: 50, ampacity90C: 55 },
  "10": { resistance: 0.9989, ampacity60C: 30, ampacity75C: 35, ampacity90C: 40 },
  "12": { resistance: 1.588, ampacity60C: 25, ampacity75C: 25, ampacity90C: 30 },
  "14": { resistance: 2.525, ampacity60C: 20, ampacity75C: 20, ampacity90C: 25 },
  "16": { resistance: 4.016, ampacity60C: 18, ampacity75C: 18, ampacity90C: 18 },
  "18": { resistance: 6.385, ampacity60C: 14, ampacity75C: 14, ampacity90C: 14 },
};

function getTemperatureDerating(tempC: number): number {
  if (tempC <= 25) return 1.08;
  if (tempC <= 30) return 1.00;
  if (tempC <= 35) return 0.91;
  if (tempC <= 40) return 0.82;
  if (tempC <= 45) return 0.71;
  if (tempC <= 50) return 0.58;
  return 0.41;
}

function getAmpacity(gauge: string, insulationType: "60C" | "75C" | "90C"): number {
  const data = WIRE_DATA[gauge as keyof typeof WIRE_DATA];
  if (!data) return 0;

  switch (insulationType) {
    case "60C": return data.ampacity60C;
    case "75C": return data.ampacity75C;
    case "90C": return data.ampacity90C;
    default: return data.ampacity75C;
  }
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
  insulationType?: "60C" | "75C" | "90C";
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
    insulationType = "75C",
    bundlingFactor = 1.0,
    maxVoltageDrop = 3.0, // 3% per ABYC standard
    currentGauge,
  } = params;
  
  // Normalize current gauge (remove " AWG" suffix if present)
  const normalizedCurrentGauge = currentGauge ? currentGauge.replace(" AWG", "").trim().replace(/\\0/g, "/0") : undefined;

  // Calculate maximum allowable voltage drop
  const maxVDropVolts = (voltage * maxVoltageDrop) / 100;

  // Temperature derating factor
  const tempDeratingFactor = getTemperatureDerating(temperatureC);

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
        message = "Wire size meets ABYC/NEC standards.";
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
        message = `Current (${current}A) exceeds maximum ampacity (${deratedAmpacity.toFixed(0)}A). Reduce current or use parallel runs.`;
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
