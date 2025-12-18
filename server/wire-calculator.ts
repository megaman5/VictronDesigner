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

const WIRE_GAUGES = Object.keys(WIRE_DATA);

// Temperature derating factors per NEC Table 310.15(B)(2)(a)
const TEMP_DERATING = {
  "21-25": 1.08,
  "26-30": 1.00,
  "31-35": 0.91,
  "36-40": 0.82,
  "41-45": 0.71,
  "46-50": 0.58,
  "51-55": 0.41,
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

// Export function to get wire ampacity for validation
export function getWireAmpacity(gauge: string, insulationType: "60C" | "75C" | "90C" = "75C", temperatureC: number = 30, bundlingFactor: number = 1.0): number {
  const baseAmpacity = getAmpacity(gauge, insulationType);
  if (baseAmpacity === 0) return 0;

  const tempDeratingFactor = getTemperatureDerating(temperatureC);
  return baseAmpacity * tempDeratingFactor * bundlingFactor;
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
  } = params;

  // Calculate maximum allowable voltage drop
  const maxVDropVolts = (voltage * maxVoltageDrop) / 100;

  // Temperature derating factor
  const tempDeratingFactor = getTemperatureDerating(temperatureC);

  // Find the smallest gauge that meets both voltage drop and ampacity requirements
  let recommendedGauge = "4/0";
  let actualVoltageDrop = 0;
  let voltageDropPercent = 0;
  let status: "valid" | "warning" | "error" = "valid";
  let message = "";

  // Create a reversed copy to avoid mutating the global array
  const gaugesLargestToSmallest = [...WIRE_GAUGES].reverse();
  
  for (const gauge of gaugesLargestToSmallest) {
    const wireData = WIRE_DATA[gauge as keyof typeof WIRE_DATA];
    
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
      break;
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

export function calculateLoadRequirements(components: any[]): {
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
    const power = comp.properties?.power || 0;
    
    if (comp.type === "dc-load") {
      dcLoads += power;
    } else if (comp.type === "ac-load") {
      acLoads += power;
    } else if (comp.type === "solar-panel") {
      solarPower += power;
    }
  });

  const totalPower = dcLoads + acLoads;
  const peakPower = totalPower * 1.25; // 25% safety margin
  const averagePower = totalPower * 0.7; // Assume 70% duty cycle

  // Battery capacity: enough for 24 hours at average load
  // Ah = (Wh per day) / voltage / depth of discharge
  const batteryCapacityRequired = (averagePower * 24) / 12 / 0.5; // 50% DOD

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
