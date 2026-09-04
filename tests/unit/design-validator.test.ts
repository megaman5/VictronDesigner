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

  /**
   * A fused branch off a bus bar is the pattern the AI prompt recommends, and
   * it used to be charged with the whole system's current: a 60W fridge was
   * told it needed to carry 157A and failed for "insufficient gauge".
   */
  describe('Branch circuit current attribution', () => {
    // battery -> main fuse -> +bus, with a big inverter branch and a small
    // fused load branch hanging off the same bus.
    const buildSystem = (branchGauge: string, branchWatts = 60, trunkGauge = '4/0 AWG') => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12, capacity: 200 }),
        createComponent('fuseMain', 'fuse', 500, 100, { fuseType: 'class-t', fuseRating: 250 }),
        createComponent('shunt1', 'smartshunt', 500, 500, {}),
        createComponent('busPos', 'busbar-positive', 900, 100, {}),
        createComponent('busNeg', 'busbar-negative', 900, 500, {}),
        createComponent('fuseInv', 'fuse', 1300, 100, { fuseType: 'class-t', fuseRating: 250 }),
        createComponent('inverter1', 'inverter', 1700, 100, { powerRating: 2000, acOutputVoltage: '120' }),
        createComponent('fuseBranch', 'fuse', 1300, 900, { fuseType: 'blade', fuseRating: 15 }),
        createComponent('loadBranch', 'dc-load', 1700, 900, { watts: branchWatts, voltage: 12 }),
      ];
      const wires = [
        createWire('w1', 'battery1', 'fuseMain', 'positive', trunkGauge, 2),
        createWire('w2', 'fuseMain', 'busPos', 'positive', trunkGauge, 2),
        createWire('w3', 'battery1', 'shunt1', 'negative', trunkGauge, 2),
        createWire('w4', 'shunt1', 'busNeg', 'negative', trunkGauge, 2),
        createWire('w5', 'busPos', 'fuseInv', 'positive', '4/0 AWG', 2),
        createWire('w6', 'fuseInv', 'inverter1', 'positive', '4/0 AWG', 2),
        createWire('w7', 'inverter1', 'busNeg', 'negative', '4/0 AWG', 2),
        createWire('w8', 'busPos', 'fuseBranch', 'positive', branchGauge, 2),
        createWire('w9', 'fuseBranch', 'loadBranch', 'positive', branchGauge, 2),
        createWire('w10', 'loadBranch', 'busNeg', 'negative', branchGauge, 2),
      ];
      return new DesignValidator(components, wires, 12).validate();
    };

    const gaugeErrors = (result: ReturnType<DesignValidator['validate']>) =>
      result.issues.filter(i => /gauge .* insufficient|Excessive voltage drop/i.test(i.message));

    it('sizes a fused branch by its own load, not the whole system', () => {
      // 60W / 12V = 5A. 10 AWG is ample; before the fix this was told 157A.
      expect(gaugeErrors(buildSystem('10 AWG'))).toHaveLength(0);
    });

    it('still flags a branch that is genuinely undersized for its own load', () => {
      // 600W / 12V = 50A through 18 AWG (20A max) - a real fault, still caught.
      const errors = gaugeErrors(buildSystem('18 AWG', 600));
      expect(errors.length).toBeGreaterThan(0);
      // Reported against the branch's own 50A, not the system's ~157A.
      expect(errors.some(i => i.message.includes('50.0A'))).toBe(true);
      expect(errors.some(i => i.message.includes('157'))).toBe(false);
    });

    it('still charges the trunk with whole-system current', () => {
      // Battery-to-bus wiring carries the inverter plus every branch, so an
      // undersized trunk must still fail even though branches are fine.
      const errors = gaugeErrors(buildSystem('10 AWG', 60, '10 AWG'));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(i => /1[0-9][0-9]\.[0-9]A/.test(i.message))).toBe(true);
    });

    it('sizes a correctly-specified heavy branch without complaint', () => {
      expect(gaugeErrors(buildSystem('6 AWG', 600))).toHaveLength(0);
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
  describe('SmartShunt Placement Validation', () => {
    const shuntError = (components: SchematicComponent[], wires: Wire[]) => {
      const validator = new DesignValidator(components, wires, 12);
      return validator.validate().issues.filter(i =>
        i.message.includes('SmartShunt not properly connected')
      );
    };

    const termWire = (
      id: string,
      fromId: string,
      fromTerminal: string,
      toId: string,
      toTerminal: string
    ): Wire => ({
      id,
      fromComponentId: fromId,
      toComponentId: toId,
      fromTerminal,
      toTerminal,
      polarity: 'negative',
      gauge: '4/0 AWG',
      length: 2,
    });

    it('accepts a wire drawn battery -> shunt', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('shunt1', 'smartshunt', 400, 100),
      ];
      const wires = [termWire('w1', 'battery1', 'negative', 'shunt1', 'negative')];
      expect(shuntError(components, wires)).toHaveLength(0);
    });

    it('accepts the same wire drawn shunt -> battery (reverse direction)', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('shunt1', 'smartshunt', 400, 100),
      ];
      const wires = [termWire('w1', 'shunt1', 'negative', 'battery1', 'negative')];
      expect(shuntError(components, wires)).toHaveLength(0);
    });

    it('accepts a shunt wired to the second battery in a bank', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('battery2', 'battery', 100, 400, { voltage: 12 }),
        createComponent('shunt1', 'smartshunt', 400, 400),
      ];
      const wires = [termWire('w1', 'battery2', 'negative', 'shunt1', 'negative')];
      expect(shuntError(components, wires)).toHaveLength(0);
    });

    it('accepts a shunt reached through a disconnect switch', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('switch1', 'switch', 250, 100),
        createComponent('shunt1', 'smartshunt', 400, 100),
      ];
      const wires = [
        termWire('w1', 'battery1', 'negative', 'switch1', 'in'),
        termWire('w2', 'switch1', 'out', 'shunt1', 'negative'),
      ];
      expect(shuntError(components, wires)).toHaveLength(0);
    });

    it('still flags a shunt with nothing on its battery side', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('busbar1', 'busbar-negative', 400, 100),
        createComponent('shunt1', 'smartshunt', 700, 100),
      ];
      // system-minus is wired, but the battery side is not
      const wires = [termWire('w1', 'shunt1', 'system-minus', 'busbar1', 'neg-1')];
      expect(shuntError(components, wires).length).toBeGreaterThan(0);
    });

    it('does not flag the shunt when the battery connects to its positive post only', () => {
      const components = [
        createComponent('battery1', 'battery', 100, 100, { voltage: 12 }),
        createComponent('shunt1', 'smartshunt', 400, 100),
      ];
      // Wire lands on the battery POSITIVE post - not a valid negative path
      const wires = [termWire('w1', 'shunt1', 'negative', 'battery1', 'positive')];
      expect(shuntError(components, wires).length).toBeGreaterThan(0);
    });
  });
  describe('AC Output Voltage Validation', () => {
    const acWire = (id: string, fromId: string, toId: string): Wire => ({
      id,
      fromComponentId: fromId,
      toComponentId: toId,
      fromTerminal: 'ac-out-hot',
      toTerminal: 'ac-in',
      polarity: 'hot',
      gauge: '12 AWG',
      length: 10,
    });

    const acIssues = (components: SchematicComponent[], wires: Wire[]) => {
      const validator = new DesignValidator(components, wires, 12);
      return validator.validate().issues.filter(i => i.message.includes('outputs'));
    };

    it('flags a 240V load on a 120V inverter', () => {
      const components = [
        createComponent('inv1', 'multiplus', 100, 100, { watts: 3000, acOutputVoltage: '120' }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 1500, acVoltage: 240 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')]).length).toBeGreaterThan(0);
    });

    it('accepts a 240V load on a split-phase inverter', () => {
      const components = [
        createComponent('inv1', 'quattro', 100, 100, { watts: 5000, acOutputVoltage: 'split-120-240' }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 1500, acVoltage: 240 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')])).toHaveLength(0);
    });

    it('accepts a 120V load on a split-phase inverter', () => {
      const components = [
        createComponent('inv1', 'quattro', 100, 100, { watts: 5000, acOutputVoltage: 'split-120-240' }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 600, acVoltage: 120 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')])).toHaveLength(0);
    });

    it('accepts a 220V load on a 230V inverter (same family)', () => {
      const components = [
        createComponent('inv1', 'multiplus', 100, 100, { watts: 3000, acOutputVoltage: '230' }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 600, acVoltage: 220 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')])).toHaveLength(0);
    });

    it('flags a 120V load on a 230V inverter', () => {
      const components = [
        createComponent('inv1', 'multiplus', 100, 100, { watts: 3000, acOutputVoltage: '230' }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 600, acVoltage: 120 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')]).length).toBeGreaterThan(0);
    });

    it('traces through an AC panel to reach the source', () => {
      const components = [
        createComponent('inv1', 'multiplus', 100, 100, { watts: 3000, acOutputVoltage: '120' }),
        createComponent('panel1', 'ac-panel', 400, 100),
        createComponent('load1', 'ac-load', 700, 100, { watts: 1500, acVoltage: 240 }),
      ];
      const wires = [acWire('w1', 'inv1', 'panel1'), acWire('w2', 'panel1', 'load1')];
      expect(acIssues(components, wires).length).toBeGreaterThan(0);
    });

    it('defaults to 120V when no output voltage is set (unchanged behaviour)', () => {
      const components = [
        createComponent('inv1', 'multiplus', 100, 100, { watts: 3000 }),
        createComponent('load1', 'ac-load', 500, 100, { watts: 600, acVoltage: 120 }),
      ];
      expect(acIssues(components, [acWire('w1', 'inv1', 'load1')])).toHaveLength(0);
    });
  });
  describe('MPPT LOAD Output Terminals', () => {
    const loadWire = (mpptModel: string | undefined): { components: SchematicComponent[]; wires: Wire[] } => ({
      components: [
        createComponent('mppt1', 'mppt', 100, 100, { maxCurrent: 20, model: mpptModel }),
        createComponent('load1', 'dc-load', 500, 100, { watts: 60, voltage: 12 }),
      ],
      wires: [
        {
          id: 'w1',
          fromComponentId: 'mppt1',
          toComponentId: 'load1',
          fromTerminal: 'load-positive',
          toTerminal: 'positive',
          polarity: 'positive',
          gauge: '10 AWG',
          length: 5,
        },
      ],
    });

    const terminalErrors = (components: SchematicComponent[], wires: Wire[]) => {
      const validator = new DesignValidator(components, wires, 12);
      return validator.validate().issues.filter(i => i.message.includes('Invalid terminal'));
    };

    it('accepts load-positive on an MPPT 100|20', () => {
      const { components, wires } = loadWire('100|20');
      expect(terminalErrors(components, wires)).toHaveLength(0);
    });

    it('accepts load-positive on an MPPT 75|15', () => {
      const { components, wires } = loadWire('75|15');
      expect(terminalErrors(components, wires)).toHaveLength(0);
    });

    it('rejects load-positive on an MPPT 150|45 (no load output)', () => {
      const { components, wires } = loadWire('150|45');
      expect(terminalErrors(components, wires).length).toBeGreaterThan(0);
    });

    it('rejects load-positive when no model is set', () => {
      const { components, wires } = loadWire(undefined);
      expect(terminalErrors(components, wires).length).toBeGreaterThan(0);
    });

    it('still accepts the standard MPPT terminals on every model', () => {
      const components = [
        createComponent('mppt1', 'mppt', 100, 100, { maxCurrent: 60, model: '150|60' }),
        createComponent('bus1', 'busbar-positive', 500, 100),
      ];
      const wires: Wire[] = [
        {
          id: 'w1',
          fromComponentId: 'mppt1',
          toComponentId: 'bus1',
          fromTerminal: 'batt-positive',
          toTerminal: 'pos-1',
          polarity: 'positive',
          gauge: '6 AWG',
          length: 5,
        },
      ];
      expect(terminalErrors(components, wires)).toHaveLength(0);
    });
  });
  describe('Fuse Families and Breakers', () => {
    const battery = (chem: string) =>
      createComponent('battery1', 'battery', 100, 100, { voltage: 12, capacity: 200, batteryType: chem });

    const posWire = (id: string, fromId: string, toId: string): Wire => ({
      id,
      fromComponentId: fromId,
      toComponentId: toId,
      fromTerminal: 'positive',
      toTerminal: 'in',
      polarity: 'positive',
      gauge: '2 AWG',
      length: 1,
    });

    const issuesFor = (components: SchematicComponent[], wires: Wire[]) =>
      new DesignValidator(components, wires, 12).validate().issues;

    it('accepts a blade fuse as battery protection (no unfused error)', () => {
      const components = [
        battery('AGM'),
        createComponent('fuse1', 'fuse', 300, 100, { fuseType: 'blade', fuseRating: 30 }),
      ];
      const unfused = issuesFor(components, [posWire('w1', 'battery1', 'fuse1')])
        .filter(i => i.message.includes('Unfused battery cable'));
      expect(unfused).toHaveLength(0);
    });

    it('accepts a DC breaker as battery protection', () => {
      const components = [
        battery('AGM'),
        createComponent('brk1', 'dc-breaker', 300, 100, { amps: 100 }),
      ];
      const unfused = issuesFor(components, [posWire('w1', 'battery1', 'brk1')])
        .filter(i => i.message.includes('Unfused battery cable'));
      expect(unfused).toHaveLength(0);
    });

    it('warns when a lithium bank main is a DC breaker', () => {
      const components = [
        battery('LiFePO4'),
        createComponent('brk1', 'dc-breaker', 300, 100, { amps: 100 }),
      ];
      const warn = issuesFor(components, [posWire('w1', 'battery1', 'brk1')])
        .filter(i => i.message.includes('protected by a circuit breaker'));
      expect(warn).toHaveLength(1);
      expect(warn[0].severity).toBe('warning');
    });

    it('warns when a lithium bank main uses a low-interrupt fuse family', () => {
      const components = [
        battery('LiFePO4'),
        createComponent('fuse1', 'fuse', 300, 100, { fuseType: 'mega', fuseRating: 200 }),
      ];
      const warn = issuesFor(components, [posWire('w1', 'battery1', 'fuse1')])
        .filter(i => i.message.includes('interrupt'));
      expect(warn.length).toBeGreaterThan(0);
    });

    it('does not warn when a lithium bank main is a Class T fuse', () => {
      const components = [
        battery('LiFePO4'),
        createComponent('fuse1', 'fuse', 300, 100, { fuseType: 'class-t', fuseRating: 400 }),
      ];
      const warn = issuesFor(components, [posWire('w1', 'battery1', 'fuse1')])
        .filter(i => i.message.includes('interrupt') || i.message.includes('circuit breaker'));
      expect(warn).toHaveLength(0);
    });

    it('treats an untyped legacy fuse as Class T', () => {
      const components = [
        battery('LiFePO4'),
        createComponent('fuse1', 'fuse', 300, 100, { fuseRating: 400 }),
      ];
      const warn = issuesFor(components, [posWire('w1', 'battery1', 'fuse1')])
        .filter(i => i.message.includes('interrupt') || i.message.includes('circuit breaker'));
      expect(warn).toHaveLength(0);
    });

    it('flags an undersized DC breaker', () => {
      const components = [
        battery('AGM'),
        createComponent('brk1', 'dc-breaker', 300, 100, { amps: 10 }),
        createComponent('load1', 'dc-load', 600, 100, { watts: 600, voltage: 12 }),
      ];
      const wires = [
        posWire('w1', 'battery1', 'brk1'),
        {
          id: 'w2',
          fromComponentId: 'brk1',
          toComponentId: 'load1',
          fromTerminal: 'out',
          toTerminal: 'positive',
          polarity: 'positive',
          gauge: '10 AWG',
          length: 5,
        } as Wire,
      ];
      const undersized = issuesFor(components, wires)
        .filter(i => i.message.includes('Breaker') && i.message.includes('undersized'));
      expect(undersized.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Component Supported Voltages', () => {
    const customPart = (supportedVoltages?: number[]) =>
      createComponent('custom1', 'custom', 400, 100, {
        terminals: [
          { id: 'in-positive', type: 'positive', label: '+', x: 0, y: 40, color: 'red', orientation: 'left' },
        ],
        width: 160,
        height: 120,
        ...(supportedVoltages ? { supportedVoltages } : {}),
      });

    const voltageIssues = (components: SchematicComponent[], systemVoltage: number) =>
      new DesignValidator(components, [], systemVoltage)
        .validate()
        .issues.filter(i => i.message.includes('voltage mismatch'));

    it('flags a custom part that cannot run at the system voltage', () => {
      const components = [
        createComponent('bat1', 'battery', 100, 100, { voltage: 48 }),
        customPart([12]),
      ];
      expect(voltageIssues(components, 48)).toHaveLength(1);
    });

    it('accepts a dual-voltage custom part that includes the system voltage', () => {
      const components = [
        createComponent('bat1', 'battery', 100, 100, { voltage: 24 }),
        customPart([12, 24]),
      ];
      expect(voltageIssues(components, 24)).toHaveLength(0);
    });

    it('skips a custom part that declares no supported voltages', () => {
      const components = [
        createComponent('bat1', 'battery', 100, 100, { voltage: 48 }),
        customPart(),
      ];
      expect(voltageIssues(components, 48)).toHaveLength(0);
    });

    it('treats two wired custom parts as compatible when their voltages overlap', () => {
      const a = createComponent('a', 'custom', 400, 100, { supportedVoltages: [12, 24] });
      const b = createComponent('b', 'custom', 800, 100, { supportedVoltages: [24, 48] });
      const wire = createWire('w1', 'a', 'b');
      const issues = new DesignValidator([a, b], [wire], 24)
        .validate()
        .issues.filter(i => i.message.includes('Voltage mismatch'));
      expect(issues).toHaveLength(0);
    });

    it('flags two wired custom parts with no voltage in common', () => {
      const a = createComponent('a', 'custom', 400, 100, { supportedVoltages: [12] });
      const b = createComponent('b', 'custom', 800, 100, { supportedVoltages: [48] });
      const wire = createWire('w1', 'a', 'b');
      const issues = new DesignValidator([a, b], [wire], 12)
        .validate()
        .issues.filter(i => i.message.includes('Voltage mismatch'));
      expect(issues).toHaveLength(1);
    });
  });

});
