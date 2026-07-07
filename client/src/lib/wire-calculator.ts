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

function normalizeGauge(gauge: string): string {
  return gauge.replace(" AWG", "").trim().replace(/\\0/g, "/0");
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
  const normalizedCurrentGauge = currentGauge ? currentGauge.replace(" AWG", "").trim().replace(/\\0/g, "/0") : undefined;

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

  // First, check if the current gauge meets requirements
  let currentGaugeMeetsRequirements = false;
  if (normalizedCurrentGauge) {
    const wireData = WIRE_DATA[normalizedCurrentGauge as keyof typeof WIRE_DATA];
    if (wireData) {
      const resistancePerFoot = wireData.resistance / 1000;
      const vDrop = 2 * current * resistancePerFoot * length;
      const vDropPercent = (vDrop / voltage) * 100;
      const baseAmpacity = getAmpacity(normalizedCurrentGauge, insulationType);
      const deratedAmpacity = baseAmpacity * tempDeratingFactor * bundlingFactor;
      
      currentGaugeMeetsRequirements = (vDrop <= maxVDropVolts && current <= deratedAmpacity);
      
      // Check if current gauge is close to limits (warning status)
      // Use 2.5% as warning threshold (same as server-side validation)
      const warningThreshold = maxVoltageDrop * 0.833; // 2.5% of 3% = 83.3%
      const isNearLimit = vDropPercent > warningThreshold || current > deratedAmpacity * 0.9;
      
      // If current gauge meets requirements AND is well within limits, use it
      // If it's close to limits (warning), we'll recommend a larger gauge instead
      if (currentGaugeMeetsRequirements && !isNearLimit) {
        recommendedGauge = normalizedCurrentGauge;
        actualVoltageDrop = vDrop;
        voltageDropPercent = vDropPercent;
        status = "valid";
        message = "Wire size meets ABYC E-11 marine standards.";
      } else if (currentGaugeMeetsRequirements && isNearLimit) {
        // Current gauge meets requirements but is close to limit - recommend larger
        // Don't set recommendedGauge here, let the loop below find a larger one
        currentGaugeMeetsRequirements = false; // Force finding a larger gauge
      }
    }
  }

  // If current gauge doesn't meet requirements, find the next larger gauge that does
  if (!currentGaugeMeetsRequirements) {
    let foundValidGauge = false;
    for (const gauge of gaugeOrder) {
      const wireData = WIRE_DATA[gauge as keyof typeof WIRE_DATA];
      if (!wireData) continue;
      
      // If we have a current gauge, skip any gauges smaller than or equal to it
      // (we want to recommend a LARGER gauge if current doesn't meet requirements)
      if (normalizedCurrentGauge) {
        // Skip if this gauge is smaller than current
        if (!compareGaugeSizes(gauge, normalizedCurrentGauge)) {
          continue; // Skip this gauge - it's smaller than current
        }
        // Skip if this gauge is the same as current (we want larger if current doesn't work)
        if (gauge === normalizedCurrentGauge) {
          continue; // Skip current gauge - we want larger
        }
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
        foundValidGauge = true;

        // Set status based on how close we are to limits
        if (vDropPercent > maxVoltageDrop * 0.9 || current > deratedAmpacity * 0.9) {
          status = "warning";
          message = "Wire size is near maximum capacity. Consider larger gauge.";
        } else {
          status = "valid";
          message = "Wire size meets ABYC E-11 marine standards.";
        }
        break; // Found the smallest gauge that works (and is > current gauge)
      }
    }
    
    // If we didn't find a valid larger gauge, mark as error
    if (!foundValidGauge && normalizedCurrentGauge) {
      const wireData = WIRE_DATA[normalizedCurrentGauge as keyof typeof WIRE_DATA];
      if (wireData) {
        const resistancePerFoot = wireData.resistance / 1000;
        const vDrop = 2 * current * resistancePerFoot * length;
        const vDropPercent = (vDrop / voltage) * 100;
        const baseAmpacity = getAmpacity(normalizedCurrentGauge, insulationType);
        const deratedAmpacity = baseAmpacity * tempDeratingFactor * bundlingFactor;
        
        recommendedGauge = normalizedCurrentGauge; // Keep current for display, but mark as error
        actualVoltageDrop = vDrop;
        voltageDropPercent = vDropPercent;
        status = "error";
        if (vDrop > maxVDropVolts) {
          message = `Voltage drop (${vDropPercent.toFixed(1)}%) exceeds ${maxVoltageDrop}% limit. Consider larger gauge.`;
        } else {
          message = `Current (${current.toFixed(1)}A) exceeds maximum ampacity (${deratedAmpacity.toFixed(0)}A). Consider larger gauge.`;
        }
      }
    }
  }

  // If no gauge is sufficient and we haven't set status yet (no current gauge case), use the largest and mark as invalid
  if (recommendedGauge === "4/0" && status === "valid" && !normalizedCurrentGauge) {
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
