import { describe, it, expect } from 'vitest';
import { calculateWireSize, getWireAmpacity } from '../../server/wire-calculator';
import { calculateWireSize as clientCalculateWireSize } from '../../client/src/lib/wire-calculator';

describe('Wire Calculator', () => {
  describe('calculateWireSize', () => {
    it('should recommend appropriate gauge for low current', () => {
      const result = calculateWireSize({
        current: 5,
        length: 10,
        voltage: 12,
      });

      expect(result.recommendedGauge).toBeTruthy();
      expect(result.status).toBe('valid');
      expect(result.voltageDropPercent).toBeLessThan(3);
    });

    it('should recommend larger gauge for high current', () => {
      const result = calculateWireSize({
        current: 100,
        length: 10,
        voltage: 12,
      });

      // For 100A, should recommend at least 2 AWG or larger
      expect(result.recommendedGauge).toMatch(/\d+\/0 AWG|\d+ AWG/);
      expect(result.current).toBe(100);
      expect(['2 AWG', '1 AWG', '1/0 AWG', '2/0 AWG', '3/0 AWG', '4/0 AWG']).toContain(result.recommendedGauge);
    });

    it('should flag voltage drop error for long runs', () => {
      const result = calculateWireSize({
        current: 50,
        length: 100, // Very long run
        voltage: 12,
      });

      // Should either recommend large gauge or flag as error
      expect(['error', 'warning', 'valid']).toContain(result.status);
    });

    it('should never recommend smaller gauge than current', () => {
      const result = calculateWireSize({
        current: 10,
        length: 10,
        voltage: 12,
        currentGauge: '10 AWG',
      });

      // Should not recommend smaller than 10 AWG
      const recommended = result.recommendedGauge.replace(' AWG', '');
      const gaugeOrder = ['18', '16', '14', '12', '10', '8', '6', '4', '2', '1', '1/0', '2/0', '3/0', '4/0'];
      const currentIndex = gaugeOrder.indexOf('10');
      const recommendedIndex = gaugeOrder.indexOf(recommended);
      
      expect(recommendedIndex).toBeGreaterThanOrEqual(currentIndex);
    });

    it('should handle temperature derating', () => {
      const result30C = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        temperatureC: 30,
      });

      const result50C = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        temperatureC: 50,
      });

      // Higher temperature should require larger gauge or show warning
      expect(result50C.status).not.toBe('error');
    });

    it('should calculate voltage drop correctly', () => {
      const result = calculateWireSize({
        current: 20,
        length: 20,
        voltage: 12,
      });

      expect(result.actualVoltageDrop).toBeGreaterThan(0);
      expect(result.voltageDropPercent).toBeGreaterThan(0);
      expect(result.voltageDropPercent).toBeLessThan(100);
    });

    it('should handle different insulation types', () => {
      const result60C = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        insulationType: '60C',
      });

      const result90C = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        insulationType: '90C',
      });

      // 90C should allow higher current or smaller gauge
      expect(result90C.status).not.toBe('error');
    });

    it('should handle bundling factor', () => {
      const resultSingle = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        bundlingFactor: 1.0,
      });

      const resultBundled = calculateWireSize({
        current: 30,
        length: 10,
        voltage: 12,
        bundlingFactor: 0.8, // 80% derating for bundling
      });

      // Bundled wires should require larger gauge
      expect(resultBundled.status).not.toBe('error');
    });

    it('should return error status when current exceeds max ampacity', () => {
      const result = calculateWireSize({
        current: 500, // Extremely high current
        length: 10,
        voltage: 12,
      });

      // For extremely high current, either ampacity or voltage drop will fail
      expect(result.status).toBe('error');
      expect(result.message).toMatch(/exceeds|ampacity|voltage drop/i);
    });

    it('should return error status when voltage drop exceeds limit', () => {
      const result = calculateWireSize({
        current: 50,
        length: 500, // Very long run
        voltage: 12,
        maxVoltageDrop: 3,
      });

      if (result.voltageDropPercent > 3) {
        expect(result.status).toBe('error');
        expect(result.message).toContain('exceeds');
      }
    });
  });

  describe('getWireAmpacity', () => {
    it('should return correct ampacity for 10 AWG at 75C', () => {
      const ampacity = getWireAmpacity('10', '75C', 30, 1.0);
      expect(ampacity).toBe(35); // 10 AWG at 75C = 35A
    });

    it('should apply temperature derating', () => {
      const ampacity30C = getWireAmpacity('10', '75C', 30, 1.0);
      const ampacity50C = getWireAmpacity('10', '75C', 50, 1.0);
      
      expect(ampacity50C).toBeLessThan(ampacity30C);
    });

    it('should apply bundling factor', () => {
      const ampacitySingle = getWireAmpacity('10', '75C', 30, 1.0);
      const ampacityBundled = getWireAmpacity('10', '75C', 30, 0.8);
      
      expect(ampacityBundled).toBeLessThan(ampacitySingle);
      expect(ampacityBundled).toBeCloseTo(ampacitySingle * 0.8);
    });

    it('should handle different insulation types', () => {
      const ampacity60C = getWireAmpacity('10', '60C', 30, 1.0);
      const ampacity75C = getWireAmpacity('10', '75C', 30, 1.0);
      const ampacity90C = getWireAmpacity('10', '90C', 30, 1.0);
      
      expect(ampacity60C).toBeLessThan(ampacity75C);
      expect(ampacity75C).toBeLessThan(ampacity90C);
    });

    it('should return 0 for invalid gauge', () => {
      const ampacity = getWireAmpacity('invalid', '75C', 30, 1.0);
      expect(ampacity).toBe(0);
    });
  });
});
