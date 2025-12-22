import { describe, it, expect } from 'vitest';
import type { SchematicComponent } from '@shared/schema';
import { calculateRuntimeEstimates } from '../../server/runtime-calculator';

describe('Runtime Estimates Calculator', () => {
  describe('Daily Energy Consumption', () => {
    it('should calculate daily consumption from DC and AC loads with daily hours', () => {
      const components: SchematicComponent[] = [
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 100,
          y: 100,
          properties: {
            watts: 100,
            voltage: 12,
            dailyHours: 8, // 8 hours per day
          },
        },
        {
          id: 'ac-load-1',
          type: 'ac-load',
          name: 'AC Load',
          x: 200,
          y: 100,
          properties: {
            watts: 500,
            acVoltage: 120,
            dailyHours: 4, // 4 hours per day
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // DC: 100W × 8h = 800Wh
      // AC: 500W × 4h = 2000Wh
      // Total: 2800Wh
      expect(result.dailyConsumptionWh).toBe(2800);
    });

    it('should handle loads without dailyHours (assume 24 hours)', () => {
      const components: SchematicComponent[] = [
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 100,
          y: 100,
          properties: {
            watts: 50,
            voltage: 12,
            // No dailyHours - assume always on
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // 50W × 24h = 1200Wh
      expect(result.dailyConsumptionWh).toBe(1200);
    });

    it('should handle multiple loads correctly', () => {
      const components: SchematicComponent[] = [
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load 1',
          x: 100,
          y: 100,
          properties: { watts: 25, voltage: 12, dailyHours: 12 },
        },
        {
          id: 'dc-load-2',
          type: 'dc-load',
          name: 'DC Load 2',
          x: 200,
          y: 100,
          properties: { watts: 75, voltage: 12, dailyHours: 6 },
        },
        {
          id: 'ac-load-1',
          type: 'ac-load',
          name: 'AC Load',
          x: 300,
          y: 100,
          properties: { watts: 1000, acVoltage: 120, dailyHours: 2 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // 25W × 12h = 300Wh
      // 75W × 6h = 450Wh
      // 1000W × 2h = 2000Wh
      // Total: 2750Wh
      expect(result.dailyConsumptionWh).toBe(2750);
    });
  });

  describe('Battery Runtime', () => {
    it('should calculate runtime for LiFePO4 battery with 80% DOD', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200, // 200Ah
            voltage: 12,
            batteryType: 'LiFePO4',
            safeDOD: 80, // 80% safe DOD
          },
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 200,
          y: 100,
          properties: {
            watts: 100,
            voltage: 12,
            dailyHours: 8,
          },
        },
        {
          id: 'ac-load-1',
          type: 'ac-load',
          name: 'AC Load',
          x: 300,
          y: 100,
          properties: {
            watts: 500,
            acVoltage: 120,
            dailyHours: 4,
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Usable capacity: 200Ah × 12V × 0.8 = 1920Wh
      // Daily consumption: 2800Wh
      // Average load: 2800Wh / 24h = 116.7W
      // Runtime: 1920Wh / 116.7W = 16.5 hours
      expect(result.batteryRuntimeHours).toBeCloseTo(16.5, 1);
    });

    it('should use default DOD if safeDOD not specified', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'AGM Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 100,
            voltage: 24,
            batteryType: 'AGM',
            // No safeDOD - should use default 50% for AGM
          },
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 200,
          y: 100,
          properties: {
            watts: 200,
            voltage: 24,
            dailyHours: 12,
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 24,
      });

      // Usable: 100Ah × 24V × 0.5 = 1200Wh
      // Daily: 200W × 12h = 2400Wh
      // Average: 2400Wh / 24h = 100W
      // Runtime: 1200Wh / 100W = 12 hours
      expect(result.batteryRuntimeHours).toBeCloseTo(12, 1);
    });

    it('should handle multiple batteries (sum capacity)', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery 1',
          x: 100,
          y: 100,
          properties: {
            capacity: 100,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'battery-2',
          type: 'battery',
          name: 'Battery 2',
          x: 200,
          y: 100,
          properties: {
            capacity: 100,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 300,
          y: 100,
          properties: {
            watts: 100,
            voltage: 12,
            dailyHours: 12,
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Total capacity: 200Ah
      // Usable: 200Ah × 12V × 0.8 = 1920Wh
      // Daily: 100W × 12h = 1200Wh
      // Average: 1200Wh / 24h = 50W
      // Runtime: 1920Wh / 50W = 38.4 hours
      expect(result.batteryRuntimeHours).toBeCloseTo(38.4, 1);
    });
  });

  describe('Solar Production', () => {
    it('should calculate solar production for low/medium/high scenarios', () => {
      const components: SchematicComponent[] = [
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 100,
          y: 100,
          properties: {
            watts: 300,
            voltage: 18, // Vmp
          },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 50A × 12V = 600W capacity
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // 300W panels, MPPT can handle 600W, so harvestable = 300W
      // Low: 300W × 2h × 0.85 = 510Wh
      // Medium: 300W × 4h × 0.85 = 1020Wh
      // High: 300W × 6h × 0.85 = 1530Wh
      expect(result.dailyProductionWh.low).toBeCloseTo(510, 1);
      expect(result.dailyProductionWh.medium).toBeCloseTo(1020, 1);
      expect(result.dailyProductionWh.high).toBeCloseTo(1530, 1);
    });

    it('should sum multiple solar panels', () => {
      const components: SchematicComponent[] = [
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel 1',
          x: 100,
          y: 100,
          properties: { watts: 200, voltage: 18 },
        },
        {
          id: 'solar-2',
          type: 'solar-panel',
          name: 'Solar Panel 2',
          x: 200,
          y: 100,
          properties: { watts: 300, voltage: 18 },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 600W capacity
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Total: 500W panels, MPPT can handle 600W, so harvestable = 500W
      // Medium: 500W × 4h × 0.85 = 1700Wh
      expect(result.dailyProductionWh.medium).toBeCloseTo(1700, 1);
    });
  });

  describe('Energy Balance', () => {
    it('should calculate net daily energy (production - consumption)', () => {
      const components: SchematicComponent[] = [
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 100,
          y: 100,
          properties: { watts: 300, voltage: 18 },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 600W capacity
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 200,
          y: 100,
          properties: { watts: 100, voltage: 12, dailyHours: 8 },
        },
        {
          id: 'ac-load-1',
          type: 'ac-load',
          name: 'AC Load',
          x: 300,
          y: 100,
          properties: { watts: 500, acVoltage: 120, dailyHours: 4 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Consumption: 100W × 8h + 500W × 4h = 2800Wh
      // Production (medium): 300W × 4h × 0.85 = 1020Wh
      // Net: 1020 - 2800 = -1780Wh (deficit)
      expect(result.netDailyEnergyWh.medium).toBeCloseTo(-1780, 1);
    });

    it('should calculate autonomy days when production exceeds consumption', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 200,
          y: 100,
          properties: { watts: 600, voltage: 18 },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 600W capacity
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 300,
          y: 100,
          properties: { watts: 50, voltage: 12, dailyHours: 12 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Consumption: 50W × 12h = 600Wh
      // Production (medium): 600W × 4h × 0.85 = 2040Wh
      // Net: 2040 - 600 = 1440Wh surplus
      // Usable capacity: 200Ah × 12V × 0.8 = 1920Wh
      // Autonomy: 1920Wh / 600Wh = 3.2 days
      expect(result.netDailyEnergyWh.medium).toBeCloseTo(1440, 1);
      expect(result.autonomyDays.medium).toBeCloseTo(3.2, 1);
    });

    it('should return null autonomy when there is a deficit', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 200,
          y: 100,
          properties: { watts: 200, voltage: 18 },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 600W capacity
        },
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 300,
          y: 100,
          properties: { watts: 100, voltage: 12, dailyHours: 12 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Consumption: 1200Wh
      // Production (medium): 680Wh
      // Net: -520Wh (deficit)
      // Autonomy: null (can't sustain)
      expect(result.netDailyEnergyWh.medium).toBeCloseTo(-520, 1);
      expect(result.autonomyDays.medium).toBeNull();
    });
  });

  describe('Charging Time', () => {
    it('should calculate solar charging time for different scenarios', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 200,
          y: 100,
          properties: { watts: 300, voltage: 18 },
        },
        {
          id: 'mppt-1',
          type: 'mppt',
          name: 'MPPT',
          x: 150,
          y: 200,
          properties: { maxCurrent: 50, voltage: 12 }, // 600W capacity
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Battery: 200Ah × 12V = 2400Wh
      // Assume 50% SOC, need 1200Wh
      // Harvestable solar: 300W (limited by MPPT capacity)
      // Low: 1200Wh / (300W × 0.85 × 2h) = 2.3529 days = 56.47 hours
      // Medium: 1200Wh / (300W × 0.85 × 4h) = 1.1765 days = 28.24 hours
      // High: 1200Wh / (300W × 0.85 × 6h) = 0.7843 days = 18.82 hours
      expect(result.solarChargingTimeHours.low).toBeCloseTo(56.47, 1);
      expect(result.solarChargingTimeHours.medium).toBeCloseTo(28.24, 1);
      expect(result.solarChargingTimeHours.high).toBeCloseTo(18.82, 1);
    });

    it('should calculate shore power charging time with Blue Smart Charger', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'charger-1',
          type: 'blue-smart-charger',
          name: 'Blue Smart Charger',
          x: 200,
          y: 100,
          properties: {
            amps: 15,
            voltage: 12,
          },
        },
        {
          id: 'shore-power-1',
          type: 'shore-power',
          name: 'Shore Power',
          x: 300,
          y: 100,
          properties: {
            voltage: 120,
            maxAmps: 30,
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Battery: 200Ah × 12V = 2400Wh
      // Assume 50% SOC, need 1200Wh
      // Charger: 15A × 12V = 180W
      // Charging time: 1200Wh / 180W = 6.67 hours
      expect(result.shorePowerChargingTimeHours).toBeCloseTo(6.67, 1);
    });

    it('should return null for shore power charging if no charger connected', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
        {
          id: 'solar-1',
          type: 'solar-panel',
          name: 'Solar Panel',
          x: 200,
          y: 100,
          properties: { watts: 300, voltage: 18 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      expect(result.shorePowerChargingTimeHours).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero consumption', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            capacity: 200,
            voltage: 12,
            batteryType: 'LiFePO4',
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      expect(result.dailyConsumptionWh).toBe(0);
      // Runtime should be infinite or very large
      expect(result.batteryRuntimeHours).toBeGreaterThan(1000);
    });

    it('should handle zero production', () => {
      const components: SchematicComponent[] = [
        {
          id: 'dc-load-1',
          type: 'dc-load',
          name: 'DC Load',
          x: 100,
          y: 100,
          properties: { watts: 100, voltage: 12, dailyHours: 8 },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      expect(result.dailyProductionWh.medium).toBe(0);
      expect(result.netDailyEnergyWh.medium).toBeLessThan(0);
    });

    it('should handle missing battery properties gracefully', () => {
      const components: SchematicComponent[] = [
        {
          id: 'battery-1',
          type: 'battery',
          name: 'Battery',
          x: 100,
          y: 100,
          properties: {
            // Missing capacity
            voltage: 12,
          },
        },
      ];

      const result = calculateRuntimeEstimates({
        components,
        systemVoltage: 12,
      });

      // Should not crash, return 0 or null
      expect(result.batteryRuntimeHours).toBeGreaterThanOrEqual(0);
    });
  });
});
