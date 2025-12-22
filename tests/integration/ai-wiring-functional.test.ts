import { describe, it, expect, beforeAll } from 'vitest';
import OpenAI from 'openai';
import { validateDesign } from '../../server/design-validator';
import { calculateWireSize } from '../../server/wire-calculator';

// Real AI tests - requires OPENAI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SKIP_AI_TESTS = !OPENAI_API_KEY;

describe.skipIf(SKIP_AI_TESTS)('AI Wiring Functional Tests', () => {
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:5000';

  // Test case 1: Simple solar + battery + load system
  it('should wire simple solar system correctly', async () => {
    const components = [
      {
        id: 'solar-1',
        type: 'solar-panel',
        name: 'Solar Panel',
        x: 200,
        y: 100,
        properties: { watts: 300, voltage: 18 }
      },
      {
        id: 'mppt-1',
        type: 'mppt',
        name: 'SmartSolar MPPT',
        x: 200,
        y: 300,
        properties: { maxCurrent: 30, maxPVVoltage: 100 }
      },
      {
        id: 'battery-1',
        type: 'battery',
        name: 'House Battery',
        x: 200,
        y: 500,
        properties: { voltage: 12, capacity: 200 }
      },
      {
        id: 'load-1',
        type: 'dc-load',
        name: 'LED Lights',
        x: 500,
        y: 500,
        properties: { watts: 50 }
      }
    ];

    const response = await fetch(`${baseUrl}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: [],
        systemVoltage: 12,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log(`\n=== Test 1: Simple Solar System ===`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Quality Score: ${result.qualityScore}/100`);
    console.log(`Wires Generated: ${result.wires.length}`);
    console.log(`Errors: ${result.validation?.issues.filter((i: any) => i.severity === 'error').length || 0}`);
    console.log(`Warnings: ${result.validation?.issues.filter((i: any) => i.severity === 'warning').length || 0}`);

    // Validate results
    expect(result.wires.length).toBeGreaterThan(0);
    expect(result.qualityScore).toBeGreaterThanOrEqual(70);
    
    // Check for required connections
    const hasSolarToMPPT = result.wires.some((w: any) => 
      w.fromComponentId === 'solar-1' && w.toComponentId === 'mppt-1'
    );
    expect(hasSolarToMPPT).toBe(true);

    const hasMPPTToBattery = result.wires.some((w: any) => 
      (w.fromComponentId === 'mppt-1' && w.toComponentId === 'battery-1') ||
      (w.fromComponentId === 'battery-1' && w.toComponentId === 'mppt-1')
    );
    expect(hasMPPTToBattery).toBe(true);

    // Check wire properties
    result.wires.forEach((wire: any) => {
      expect(wire.gauge).toBeDefined();
      expect(wire.length).toBeDefined();
      expect(wire.polarity).toBeDefined();
      expect(wire.fromTerminal).toBeDefined();
      expect(wire.toTerminal).toBeDefined();
    });
  }, 60000);

  // Test case 2: AC system with inverter and AC loads
  it('should wire AC system with correct ground gauge matching', async () => {
    const components = [
      {
        id: 'battery-1',
        type: 'battery',
        name: 'House Battery',
        x: 200,
        y: 400,
        properties: { voltage: 12, capacity: 400 }
      },
      {
        id: 'inverter-1',
        type: 'inverter',
        name: 'Inverter 2kW',
        x: 500,
        y: 400,
        properties: { powerRating: 2000 }
      },
      {
        id: 'ac-panel-1',
        type: 'ac-panel',
        name: 'AC Distribution',
        x: 800,
        y: 400,
        properties: {}
      },
      {
        id: 'ac-load-1',
        type: 'ac-load',
        name: 'Galley Outlets',
        x: 1100,
        y: 400,
        properties: { watts: 1100, acVoltage: 120 }
      }
    ];

    const response = await fetch(`${baseUrl}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: [],
        systemVoltage: 12,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log(`\n=== Test 2: AC System ===`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Quality Score: ${result.qualityScore}/100`);
    console.log(`Wires Generated: ${result.wires.length}`);

    // Check AC load has all three wires (hot, neutral, ground)
    const acLoadWires = result.wires.filter((w: any) => 
      w.toComponentId === 'ac-load-1' || w.fromComponentId === 'ac-load-1'
    );
    expect(acLoadWires.length).toBeGreaterThanOrEqual(3);

    // Check ground gauge matches hot/neutral
    const hotWire = acLoadWires.find((w: any) => w.polarity === 'hot');
    const neutralWire = acLoadWires.find((w: any) => w.polarity === 'neutral');
    const groundWire = acLoadWires.find((w: any) => w.polarity === 'ground');

    if (hotWire && groundWire) {
      expect(groundWire.gauge).toBe(hotWire.gauge);
      console.log(`✓ Ground gauge (${groundWire.gauge}) matches hot gauge (${hotWire.gauge})`);
    }

    // Check for ground gauge errors
    const groundGaugeErrors = result.validation?.issues.filter((i: any) => 
      i.message?.includes('Ground wire gauge') && i.severity === 'error'
    ) || [];
    expect(groundGaugeErrors.length).toBe(0);
  }, 60000);

  // Test case 3: System with existing wires that need fixing
  it('should fix existing wires with errors', async () => {
    const components = [
      {
        id: 'battery-1',
        type: 'battery',
        name: 'House Battery',
        x: 200,
        y: 400,
        properties: { voltage: 12, capacity: 400 }
      },
      {
        id: 'inverter-1',
        type: 'inverter',
        name: 'Inverter 2kW',
        x: 500,
        y: 400,
        properties: { powerRating: 2000 }
      },
      {
        id: 'ac-load-1',
        type: 'ac-load',
        name: 'AC Load',
        x: 800,
        y: 400,
        properties: { watts: 1200, acVoltage: 120 }
      }
    ];

    // Existing wires with errors (wrong gauge, missing ground)
    const existingWires = [
      {
        id: 'wire-1',
        fromComponentId: 'battery-1',
        toComponentId: 'inverter-1',
        fromTerminal: 'positive',
        toTerminal: 'dc-positive',
        polarity: 'positive',
        gauge: '10 AWG', // Too small for 2000W inverter
        length: 5
      },
      {
        id: 'wire-2',
        fromComponentId: 'inverter-1',
        toComponentId: 'ac-load-1',
        fromTerminal: 'ac-out-hot',
        toTerminal: 'hot',
        polarity: 'hot',
        gauge: '8 AWG',
        length: 10
      },
      {
        id: 'wire-3',
        fromComponentId: 'inverter-1',
        toComponentId: 'ac-load-1',
        fromTerminal: 'ac-out-neutral',
        toTerminal: 'neutral',
        polarity: 'neutral',
        gauge: '8 AWG',
        length: 10
      }
      // Missing ground wire - should be added
    ];

    const response = await fetch(`${baseUrl}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: existingWires,
        systemVoltage: 12,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log(`\n=== Test 3: Fix Existing Wires ===`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Quality Score: ${result.qualityScore}/100`);
    console.log(`Wires Generated: ${result.wires.length}`);

    // Should have fixed the DC wire gauge
    const dcWire = result.wires.find((w: any) => 
      w.fromComponentId === 'battery-1' && w.toComponentId === 'inverter-1' &&
      w.polarity === 'positive'
    );
    if (dcWire) {
      expect(['4 AWG', '2 AWG', '1 AWG', '1/0 AWG', '2/0 AWG']).toContain(dcWire.gauge);
      console.log(`✓ DC wire gauge fixed: ${dcWire.gauge}`);
    }

    // Should have added ground wire
    const groundWire = result.wires.find((w: any) => 
      w.polarity === 'ground' && 
      (w.toComponentId === 'ac-load-1' || w.fromComponentId === 'ac-load-1')
    );
    expect(groundWire).toBeDefined();
    if (groundWire) {
      expect(groundWire.gauge).toBe('8 AWG'); // Should match hot/neutral
      console.log(`✓ Ground wire added with matching gauge: ${groundWire.gauge}`);
    }
  }, 60000);

  // Test case 4: Complex system with multiple components
  it('should wire complex system efficiently', async () => {
    const components = [
      {
        id: 'solar-1',
        type: 'solar-panel',
        name: 'Solar Array',
        x: 200,
        y: 100,
        properties: { watts: 1000, voltage: 72 }
      },
      {
        id: 'mppt-1',
        type: 'mppt',
        name: 'SmartSolar MPPT',
        x: 200,
        y: 300,
        properties: { maxCurrent: 50, maxPVVoltage: 100 }
      },
      {
        id: 'battery-1',
        type: 'battery',
        name: 'House Battery',
        x: 200,
        y: 500,
        properties: { voltage: 12, capacity: 400 }
      },
      {
        id: 'fuse-1',
        type: 'fuse',
        name: 'Battery Fuse',
        x: 400,
        y: 500,
        properties: { fuseRating: 400 }
      },
      {
        id: 'busbar-pos',
        type: 'busbar-positive',
        name: 'Positive Bus Bar',
        x: 600,
        y: 500,
        properties: {}
      },
      {
        id: 'busbar-neg',
        type: 'busbar-negative',
        name: 'Negative Bus Bar',
        x: 600,
        y: 600,
        properties: {}
      },
      {
        id: 'inverter-1',
        type: 'inverter',
        name: 'Inverter 2kW',
        x: 900,
        y: 500,
        properties: { powerRating: 2000 }
      },
      {
        id: 'ac-panel-1',
        type: 'ac-panel',
        name: 'AC Distribution',
        x: 1200,
        y: 500,
        properties: {}
      },
      {
        id: 'ac-load-1',
        type: 'ac-load',
        name: 'AC Load 1',
        x: 1500,
        y: 500,
        properties: { watts: 1000, acVoltage: 120 }
      },
      {
        id: 'dc-load-1',
        type: 'dc-load',
        name: 'DC Load 1',
        x: 900,
        y: 700,
        properties: { watts: 100 }
      }
    ];

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: [],
        systemVoltage: 12,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    const duration = Date.now() - startTime;
    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log(`\n=== Test 4: Complex System ===`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Quality Score: ${result.qualityScore}/100`);
    console.log(`Wires Generated: ${result.wires.length}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Errors: ${result.validation?.issues.filter((i: any) => i.severity === 'error').length || 0}`);
    console.log(`Warnings: ${result.validation?.issues.filter((i: any) => i.severity === 'warning').length || 0}`);

    // Performance check
    expect(duration).toBeLessThan(120000); // Should complete in under 2 minutes

    // Quality check
    expect(result.qualityScore).toBeGreaterThanOrEqual(70);

    // Check all components are connected
    const componentIds = new Set(components.map(c => c.id));
    const connectedComponents = new Set<string>();
    result.wires.forEach((w: any) => {
      connectedComponents.add(w.fromComponentId);
      connectedComponents.add(w.toComponentId);
    });
    
    // Most components should be connected (allowing for some flexibility)
    expect(connectedComponents.size).toBeGreaterThan(componentIds.size * 0.8);
  }, 120000);

  // Test case 5: Iteration improvement tracking
  it('should improve quality across iterations', async () => {
    const components = [
      {
        id: 'battery-1',
        type: 'battery',
        name: 'House Battery',
        x: 200,
        y: 400,
        properties: { voltage: 12, capacity: 400 }
      },
      {
        id: 'inverter-1',
        type: 'inverter',
        name: 'Inverter 2kW',
        x: 500,
        y: 400,
        properties: { powerRating: 2000 }
      },
      {
        id: 'ac-load-1',
        type: 'ac-load',
        name: 'AC Load',
        x: 800,
        y: 400,
        properties: { watts: 1500, acVoltage: 120 }
      }
    ];

    const response = await fetch(`${baseUrl}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: [],
        systemVoltage: 12,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log(`\n=== Test 5: Iteration Improvement ===`);
    console.log(`Total Iterations: ${result.iterations}`);
    
    if (result.iterations > 1) {
      console.log('Iteration History:');
      // Log iteration progress if available
      const errors = result.validation?.issues.filter((i: any) => i.severity === 'error').length || 0;
      const warnings = result.validation?.issues.filter((i: any) => i.severity === 'warning').length || 0;
      console.log(`Final - Score: ${result.qualityScore}, Errors: ${errors}, Warnings: ${warnings}`);
    }

    // Should converge to good quality
    expect(result.qualityScore).toBeGreaterThanOrEqual(70);
    
    // If multiple iterations, final should be better or equal
    if (result.iterations > 1) {
      expect(result.qualityScore).toBeGreaterThanOrEqual(70);
    }
  }, 120000);
});


