import type { SchematicComponent } from '@shared/schema';

// Battery safe DOD by type
const BATTERY_SAFE_DOD: Record<string, number> = {
  'LiFePO4': 80,
  'Lithium': 80,
  'AGM': 50,
  'GEL': 50,
  'FLA': 50,
};

// Solar efficiency (MPPT + losses)
const SOLAR_EFFICIENCY = 0.85;

// Sun hours per scenario
const SUN_HOURS = {
  low: 2,
  medium: 4,
  high: 6,
};

// Default SOC for charging calculations (assume 50% if not specified)
const DEFAULT_SOC = 0.5;

export interface RuntimeEstimate {
  batteryRuntimeHours: number;
  dailyConsumptionWh: number;
  dailyProductionWh: {
    low: number;
    medium: number;
    high: number;
  };
  netDailyEnergyWh: {
    low: number;
    medium: number;
    high: number;
  };
  autonomyDays: {
    low: number | null;
    medium: number | null;
    high: number | null;
  };
  solarChargingTimeHours: {
    low: number;
    medium: number;
    high: number;
  };
  shorePowerChargingTimeHours: number | null;
}

export interface CalculateRuntimeEstimatesParams {
  components: SchematicComponent[];
  systemVoltage: number;
}

/**
 * Calculate runtime and charging estimates for a system
 */
export function calculateRuntimeEstimates(
  params: CalculateRuntimeEstimatesParams
): RuntimeEstimate {
  const { components, systemVoltage } = params;

  // Calculate daily energy consumption
  let dailyConsumptionWh = 0;
  components.forEach(comp => {
    if (comp.type === 'dc-load' || comp.type === 'ac-load') {
      const watts = (comp.properties?.watts || comp.properties?.power || 0) as number;
      const dailyHours = (comp.properties?.dailyHours as number) ?? 24; // Default to 24h if not specified
      dailyConsumptionWh += watts * dailyHours;
    }
  });

  // Calculate battery capacity and usable capacity
  let totalBatteryCapacityAh = 0;
  let totalUsableCapacityWh = 0;
  let batteryVoltage = systemVoltage;
  
  components.forEach(comp => {
    if (comp.type === 'battery') {
      const capacity = (comp.properties?.capacity || 0) as number;
      const voltage = (comp.properties?.voltage || systemVoltage) as number;
      const batteryType = (comp.properties?.batteryType || 'LiFePO4') as string;
      const safeDOD = (comp.properties?.safeDOD as number) ?? (BATTERY_SAFE_DOD[batteryType] || 80);
      
      totalBatteryCapacityAh += capacity;
      const batteryWh = capacity * voltage;
      const usableWh = batteryWh * (safeDOD / 100);
      totalUsableCapacityWh += usableWh;
      
      if (voltage !== systemVoltage) {
        batteryVoltage = voltage; // Use battery voltage if different
      }
    }
  });

  // Calculate battery runtime
  const averageLoadWatts = dailyConsumptionWh / 24;
  const batteryRuntimeHours = averageLoadWatts > 0 
    ? totalUsableCapacityWh / averageLoadWatts 
    : Infinity;

  // Calculate solar production
  // First, sum up all solar panel watts
  let totalSolarPanelWatts = 0;
  components.forEach(comp => {
    if (comp.type === 'solar-panel') {
      const watts = (comp.properties?.watts || comp.properties?.power || 0) as number;
      totalSolarPanelWatts += watts;
    }
  });

  // Calculate total MPPT capacity (max output current * system voltage)
  let totalMPPTCapacityWatts = 0;
  components.forEach(comp => {
    if (comp.type === 'mppt') {
      const maxCurrent = (comp.properties?.maxCurrent || comp.properties?.amps || 0) as number;
      const mpptVoltage = (comp.properties?.voltage || systemVoltage) as number;
      const mpptCapacityWatts = maxCurrent * mpptVoltage;
      totalMPPTCapacityWatts += mpptCapacityWatts;
    }
  });

  // Actual harvestable solar is limited by MPPT capacity
  // If no MPPT, can't harvest any solar (safety check)
  const harvestableSolarWatts = totalMPPTCapacityWatts > 0
    ? Math.min(totalSolarPanelWatts, totalMPPTCapacityWatts)
    : 0;

  // Calculate daily production based on harvestable solar (limited by MPPT)
  const dailyProductionWh = {
    low: harvestableSolarWatts * SUN_HOURS.low * SOLAR_EFFICIENCY,
    medium: harvestableSolarWatts * SUN_HOURS.medium * SOLAR_EFFICIENCY,
    high: harvestableSolarWatts * SUN_HOURS.high * SOLAR_EFFICIENCY,
  };

  // Calculate net daily energy
  const netDailyEnergyWh = {
    low: dailyProductionWh.low - dailyConsumptionWh,
    medium: dailyProductionWh.medium - dailyConsumptionWh,
    high: dailyProductionWh.high - dailyConsumptionWh,
  };

  // Calculate autonomy days (only if net is positive)
  const autonomyDays = {
    low: netDailyEnergyWh.low > 0 ? totalUsableCapacityWh / dailyConsumptionWh : null,
    medium: netDailyEnergyWh.medium > 0 ? totalUsableCapacityWh / dailyConsumptionWh : null,
    high: netDailyEnergyWh.high > 0 ? totalUsableCapacityWh / dailyConsumptionWh : null,
  };

  // Calculate solar charging time (in hours)
  // Assume battery needs to charge from 50% SOC (or use property if available)
  const totalBatteryCapacityWh = totalBatteryCapacityAh * batteryVoltage;
  const currentSOC = 0.5; // Default 50%, could be from property
  const energyNeededWh = totalBatteryCapacityWh * (1 - currentSOC);

  // Charging time = energy needed / (harvestable solar watts × efficiency × sun hours per day)
  // This gives days, so multiply by 24 to get hours
  // Use harvestableSolarWatts (limited by MPPT capacity) instead of total panel watts
  const solarChargingTimeHours = {
    low: harvestableSolarWatts > 0 && SUN_HOURS.low > 0
      ? (energyNeededWh / (harvestableSolarWatts * SOLAR_EFFICIENCY * SUN_HOURS.low)) * 24
      : Infinity,
    medium: harvestableSolarWatts > 0 && SUN_HOURS.medium > 0
      ? (energyNeededWh / (harvestableSolarWatts * SOLAR_EFFICIENCY * SUN_HOURS.medium)) * 24
      : Infinity,
    high: harvestableSolarWatts > 0 && SUN_HOURS.high > 0
      ? (energyNeededWh / (harvestableSolarWatts * SOLAR_EFFICIENCY * SUN_HOURS.high)) * 24
      : Infinity,
  };

  // Calculate shore power charging time
  // Look for Blue Smart Charger or Orion DC-DC connected to shore power
  // Note: In a real system, we'd check if charger is wired to shore power, but for now we just check if charger exists
  let shorePowerChargingTimeHours: number | null = null;
  
  const charger = components.find(c => 
    c.type === 'blue-smart-charger' || 
    c.type === 'orion-dc-dc'
  );
  
  // Also check if shore power component exists (indicates shore power is available)
  const hasShorePower = components.some(c => c.type === 'shore-power');
  
  if (charger && hasShorePower && totalBatteryCapacityWh > 0) {
    const chargerAmps = (charger.properties?.amps || charger.properties?.current || 0) as number;
    const chargerVoltage = (charger.properties?.voltage || systemVoltage) as number;
    const chargerWatts = chargerAmps * chargerVoltage;
    
    if (chargerWatts > 0) {
      shorePowerChargingTimeHours = energyNeededWh / chargerWatts;
    }
  }

  return {
    batteryRuntimeHours: batteryRuntimeHours === Infinity ? 9999 : batteryRuntimeHours,
    dailyConsumptionWh,
    dailyProductionWh,
    netDailyEnergyWh,
    autonomyDays,
    solarChargingTimeHours: {
      low: solarChargingTimeHours.low === Infinity ? 0 : solarChargingTimeHours.low,
      medium: solarChargingTimeHours.medium === Infinity ? 0 : solarChargingTimeHours.medium,
      high: solarChargingTimeHours.high === Infinity ? 0 : solarChargingTimeHours.high,
    },
    shorePowerChargingTimeHours,
  };
}
