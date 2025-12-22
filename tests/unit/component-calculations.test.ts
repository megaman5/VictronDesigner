import { describe, it, expect } from 'vitest';
import { calculateInverterDCInput, getACVoltage } from '../../server/wire-calculator';
import type { SchematicComponent, Wire } from '@shared/schema';

describe('Component Calculations', () => {
  const createComponent = (
    id: string,
    type: string,
    properties: any = {}
  ): SchematicComponent => ({
    id,
    type,
    x: 100,
    y: 100,
    name: `${type}-${id}`,
    properties,
  });

  const createWire = (
    id: string,
    fromId: string,
    toId: string,
    fromTerminal: string = 'ac-out-hot',
    toTerminal: string = 'ac-in-hot'
  ): Wire => ({
    id,
    fromComponentId: fromId,
    toComponentId: toId,
    fromTerminal,
    toTerminal,
    polarity: 'hot',
  });

  describe('calculateInverterDCInput', () => {
    it('should calculate DC input from AC load', () => {
      const components = [
        createComponent('inverter1', 'multiplus', { powerRating: 2000 }),
        createComponent('acload1', 'ac-load', { watts: 1000, acVoltage: 120 }),
      ];
      const wires = [
        createWire('w1', 'inverter1', 'acload1', 'ac-out-hot', 'ac-in-hot'),
      ];

      const result = calculateInverterDCInput(
        'inverter1',
        components,
        wires,
        12
      );

      expect(result.acLoadWatts).toBe(1000);
      expect(result.dcInputWatts).toBeGreaterThan(1000); // Should account for efficiency
      expect(result.dcInputCurrent).toBeGreaterThan(0);
    });

    it('should handle multiple AC loads', () => {
      const components = [
        createComponent('inverter1', 'inverter'),
        createComponent('acload1', 'ac-load', { watts: 500, acVoltage: 120 }),
        createComponent('acload2', 'ac-load', { watts: 300, acVoltage: 120 }),
      ];
      const wires = [
        createWire('w1', 'inverter1', 'acload1'),
        createWire('w2', 'inverter1', 'acload2'),
      ];

      const result = calculateInverterDCInput(
        'inverter1',
        components,
        wires,
        12
      );

      expect(result.acLoadWatts).toBe(800);
      expect(result.dcInputWatts).toBeGreaterThan(800);
    });

    it('should handle AC loads through AC panel', () => {
      const components = [
        createComponent('inverter1', 'multiplus'),
        createComponent('acpanel1', 'ac-panel'),
        createComponent('acload1', 'ac-load', { watts: 600, acVoltage: 120 }),
      ];
      const wires = [
        createWire('w1', 'inverter1', 'acpanel1', 'ac-out-hot', 'ac-in-hot'),
        createWire('w2', 'acpanel1', 'acload1', 'ac-out-hot', 'ac-in-hot'),
      ];

      const result = calculateInverterDCInput(
        'inverter1',
        components,
        wires,
        12
      );

      expect(result.acLoadWatts).toBe(600);
    });

    it('should return zero for non-inverter component', () => {
      const components = [
        createComponent('battery1', 'battery'),
      ];
      const wires: Wire[] = [];

      const result = calculateInverterDCInput(
        'battery1',
        components,
        wires,
        12
      );

      expect(result.acLoadWatts).toBe(0);
      expect(result.dcInputCurrent).toBe(0);
    });

    it('should use inverter rating if no loads connected', () => {
      const components = [
        createComponent('inverter1', 'inverter', { powerRating: 2000 }),
      ];
      const wires: Wire[] = [];

      const result = calculateInverterDCInput(
        'inverter1',
        components,
        wires,
        12
      );

      // Should use 80% of rating as default
      expect(result.acLoadWatts).toBeGreaterThan(0);
    });

    it('should handle different AC voltages', () => {
      const components = [
        createComponent('inverter1', 'inverter'),
        createComponent('acload1', 'ac-load', { watts: 1000, acVoltage: 220 }),
      ];
      const wires = [
        createWire('w1', 'inverter1', 'acload1'),
      ];

      const result = calculateInverterDCInput(
        'inverter1',
        components,
        wires,
        12
      );

      expect(result.acVoltage).toBe(220);
      expect(result.acLoadWatts).toBe(1000);
    });
  });

  describe('getACVoltage', () => {
    it('should return acVoltage property', () => {
      const component = createComponent('load1', 'ac-load', { acVoltage: 220 });
      expect(getACVoltage(component)).toBe(220);
    });

    it('should fall back to voltage property', () => {
      const component = createComponent('load1', 'ac-load', { voltage: 120 });
      expect(getACVoltage(component)).toBe(120);
    });

    it('should default to 120V for North America', () => {
      const component = createComponent('load1', 'ac-load', {});
      expect(getACVoltage(component)).toBe(120);
    });

    it('should validate AC voltage values', () => {
      const component1 = createComponent('load1', 'ac-load', { acVoltage: 110 });
      const component2 = createComponent('load2', 'ac-load', { acVoltage: 230 });
      const component3 = createComponent('load3', 'ac-load', { acVoltage: 100 }); // Invalid

      expect(getACVoltage(component1)).toBe(110);
      expect(getACVoltage(component2)).toBe(230);
      expect(getACVoltage(component3)).toBe(120); // Should default
    });
  });
});
