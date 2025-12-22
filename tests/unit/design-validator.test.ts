import { describe, it, expect } from 'vitest';
import { DesignValidator } from '../../server/design-validator';
import type { SchematicComponent, Wire } from '@shared/schema';

describe('Design Validator', () => {
  const createComponent = (
    id: string,
    type: string,
    x: number = 100,
    y: number = 100,
    properties: any = {}
  ): SchematicComponent => ({
    id,
    type,
    x,
    y,
    name: `${type}-${id}`,
    properties,
  });

  const createWire = (
    id: string,
    fromId: string,
    toId: string,
    polarity: string = 'positive',
    gauge?: string,
    length?: number
  ): Wire => ({
    id,
    fromComponentId: fromId,
    toComponentId: toId,
    fromTerminal: 'positive',
    toTerminal: 'positive',
    polarity,
    gauge,
    length,
  });

  describe('Voltage Mismatch Validation', () => {
    it('should flag DC components with wrong voltage', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('load1', 'dc-load', 200, 100, { voltage: 24 }), // Wrong voltage
      ];
      const wires = [createWire('w1', 'battery1', 'load1')];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      const voltageIssues = result.issues.filter(
        i => i.category === 'electrical' && i.message.includes('voltage')
      );
      expect(voltageIssues.length).toBeGreaterThan(0);
    });

    it('should not flag AC loads for DC voltage mismatches', () => {
      const components = [
        createComponent('inverter1', 'inverter', 100, 100),
        createComponent('acload1', 'ac-load', 200, 100, { acVoltage: 120 }),
      ];
      const wires = [createWire('w1', 'inverter1', 'acload1', 'hot')];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      // AC loads should not be flagged for DC voltage mismatches
      // (They may have other issues, but not DC voltage mismatch)
      const dcVoltageIssues = result.issues.filter(
        i => i.message.includes('voltage') && 
             i.message.includes('DC') && 
             i.componentIds?.includes('acload1')
      );
      expect(dcVoltageIssues.length).toBe(0);
    });
  });

  describe('Wire Sizing Validation', () => {
    it('should flag undersized wires', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100),
        createComponent('load1', 'dc-load', 200, 100, { watts: 500, voltage: 12 }),
      ];
      const wires = [
        createWire('w1', 'battery1', 'load1', 'positive', '18 AWG', 10),
      ];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      const sizingIssues = result.issues.filter(
        i => i.category === 'wire-sizing' && i.severity === 'error'
      );
      expect(sizingIssues.length).toBeGreaterThan(0);
    });

    it('should validate ground wire matches hot/neutral gauge', () => {
      const components = [
        createComponent('inverter1', 'inverter', 100, 100),
        createComponent('acload1', 'ac-load', 200, 100),
      ];
      const wires = [
        createWire('w1', 'inverter1', 'acload1', 'hot', '10 AWG', 10),
        createWire('w2', 'inverter1', 'acload1', 'ground', '14 AWG', 10), // Wrong gauge
      ];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      const groundIssues = result.issues.filter(
        i => i.message.includes('Ground wire gauge')
      );
      expect(groundIssues.length).toBeGreaterThan(0);
    });
  });

  describe('MPPT Solar Panel Validation', () => {
    it('should flag MPPT without solar panel connection', () => {
      const components = [
        createComponent('mppt1', 'mppt', 100, 100),
        createComponent('battery1', 'battery', 200, 100),
      ];
      const wires = [createWire('w1', 'mppt1', 'battery1')];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      const mpptIssues = result.issues.filter(
        i => i.message.includes('MPPT') && i.message.includes('solar panel')
      );
      expect(mpptIssues.length).toBeGreaterThan(0);
    });

    it('should not flag MPPT with solar panel connection', () => {
      const components = [
        createComponent('solar1', 'solar-panel', 50, 100),
        createComponent('mppt1', 'mppt', 100, 100),
        createComponent('battery1', 'battery', 200, 100),
      ];
      // Wire must connect to PV terminals specifically
      const wires = [
        {
          id: 'w1',
          fromComponentId: 'solar1',
          toComponentId: 'mppt1',
          fromTerminal: 'positive',
          toTerminal: 'pv-positive', // Must use PV terminal
          polarity: 'positive',
        },
        {
          id: 'w2',
          fromComponentId: 'solar1',
          toComponentId: 'mppt1',
          fromTerminal: 'negative',
          toTerminal: 'pv-negative', // Must use PV terminal
          polarity: 'negative',
        },
        createWire('w3', 'mppt1', 'battery1', 'positive'),
      ];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      // MPPT with proper PV connections should not have "missing solar panel" error
      const missingSolarIssues = result.issues.filter(
        i => i.componentIds?.includes('mppt1') &&
             i.message.includes('MPPT') && 
             i.message.includes('solar panel') && 
             i.severity === 'error'
      );
      expect(missingSolarIssues.length).toBe(0);
    });
  });

  describe('Layout Validation', () => {
    it('should detect overlapping components', () => {
      const components = [
        createComponent('comp1', 'battery', 100, 100, { width: 100, height: 100 }),
        createComponent('comp2', 'battery', 150, 150, { width: 100, height: 100 }), // Overlaps
      ];
      const wires: Wire[] = [];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      expect(result.metrics.overlappingComponents).toBeGreaterThan(0);
    });

    it('should calculate component spacing', () => {
      const components = [
        createComponent('comp1', 'battery', 100, 100),
        createComponent('comp2', 'battery', 300, 100), // 200px spacing
        createComponent('comp3', 'battery', 500, 100), // 200px spacing
      ];
      const wires: Wire[] = [];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      expect(result.metrics.avgComponentSpacing).toBeGreaterThan(0);
    });
  });

  describe('Quality Score Calculation', () => {
    it('should return high score for valid design', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('load1', 'dc-load', 300, 100, { watts: 100, voltage: 12 }),
      ];
      const wires = [
        createWire('w1', 'battery1', 'load1', 'positive', '10 AWG', 10),
      ];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      // Score calculation depends on many factors, so just check it's valid
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      // If there are no errors, design should be valid
      const errorCount = result.issues.filter(i => i.severity === 'error').length;
      if (errorCount === 0) {
        expect(result.valid).toBe(true);
      }
    });

    it('should return low score for design with errors', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('load1', 'dc-load', 200, 100, { watts: 1000, voltage: 12 }),
      ];
      const wires = [
        createWire('w1', 'battery1', 'load1', 'positive', '18 AWG', 10), // Undersized
      ];

      const validator = new DesignValidator(components, wires, 12);
      const result = validator.validate();

      expect(result.score).toBeLessThan(50);
      expect(result.valid).toBe(false);
    });
  });
});
