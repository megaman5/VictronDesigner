#!/usr/bin/env node
/**
 * Functional test script for AI Wiring endpoint
 * Tests real AI calls and analyzes results to improve the wiring process
 */

// Functional test script - tests via HTTP API only
// No direct imports needed - tests the actual endpoint

// Try 127.0.0.1 instead of localhost for better Node.js compatibility
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:5000';

// Test results storage
const testResults = [];

/**
 * Run a single test case
 */
async function runTest(testName, components, existingWires = [], systemVoltage = 12) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 TEST: ${testName}`);
  console.log('='.repeat(80));

  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_URL}/api/ai-wire-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components,
        wires: existingWires,
        systemVoltage,
        maxIterations: 6,
        minQualityScore: 70
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    // Analyze results
    const errors = result.validation?.issues.filter((i) => i.severity === 'error') || [];
    const warnings = result.validation?.issues.filter((i) => i.severity === 'warning') || [];
    const wireErrors = errors.filter((i) => i.category === 'wire-sizing' || i.wireId || i.wireIds);
    const wireWarnings = warnings.filter((i) => i.category === 'wire-sizing' || i.wireId || i.wireIds);

    const testResult = {
      name: testName,
      success: result.qualityScore >= 70 && errors.length === 0,
      duration,
      iterations: result.iterations,
      qualityScore: result.qualityScore,
      wireCount: result.wires.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      wireErrorCount: wireErrors.length,
      wireWarningCount: wireWarnings.length,
      errors: errors.map(e => e.message),
      warnings: warnings.map(w => w.message),
      wireErrors: wireErrors.map(e => e.message),
      wireWarnings: wireWarnings.map(w => w.message),
      result
    };

    // Print summary
    console.log(`\n📊 RESULTS:`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Iterations: ${result.iterations}`);
    console.log(`   Quality Score: ${result.qualityScore}/100`);
    console.log(`   Wires Generated: ${result.wires.length}`);
    console.log(`   Errors: ${errors.length} (${wireErrors.length} wire-related)`);
    console.log(`   Warnings: ${warnings.length} (${wireWarnings.length} wire-related)`);

    if (errors.length > 0) {
      console.log(`\n❌ ERRORS:`);
      errors.forEach(e => console.log(`   - ${e.message}`));
    }

    if (wireWarnings.length > 0) {
      console.log(`\n⚠️  WIRE WARNINGS:`);
      wireWarnings.forEach(w => console.log(`   - ${w.message}`));
    }

    // Check specific requirements
    console.log(`\n✅ CHECKS:`);
    
    // Check all wires have required properties
    const wiresWithAllProps = result.wires.filter(w => 
      w.gauge && w.length && w.polarity && w.fromTerminal && w.toTerminal
    ).length;
    console.log(`   Wires with all properties: ${wiresWithAllProps}/${result.wires.length}`);
    
    // Check for parallel wire usage (should only be used for >230A)
    // Only count as parallel if same terminals (not just same components)
    const parallelWires = new Map();
    result.wires.forEach(w => {
      // More precise: same components AND same terminals = true parallel
      const key = `${Math.min(w.fromComponentId, w.toComponentId)}-${Math.max(w.fromComponentId, w.toComponentId)}-${w.polarity}-${w.fromTerminal}-${w.toTerminal}`;
      if (!parallelWires.has(key)) {
        parallelWires.set(key, []);
      }
      parallelWires.get(key).push(w);
    });
    
    const actualParallelRuns = Array.from(parallelWires.values()).filter(wires => wires.length > 1);
    if (actualParallelRuns.length > 0) {
      console.log(`   Parallel wire runs found: ${actualParallelRuns.length}`);
      actualParallelRuns.forEach((wires, idx) => {
        const gauges = [...new Set(wires.map(w => w.gauge))];
        // For parallel wires, current field should be TOTAL current (system divides)
        const totalCurrent = wires[0].current || 0;
        const currentPerWire = totalCurrent / wires.length;
        console.log(`     Run ${idx + 1}: ${wires.length} wires, gauges: ${gauges.join(', ')}, total current: ${totalCurrent}A (${currentPerWire.toFixed(1)}A per wire)`);
        // Check if parallel runs are only 4/0 AWG (per NEC/ABYC)
        if (gauges.some(g => !g || !g.includes('4/0'))) {
          console.log(`     ⚠️  Warning: Parallel run uses non-4/0 AWG (${gauges.join(', ')}). Should only use 4/0 AWG for parallel runs.`);
        }
        // Check if current is >230A (justification for parallel)
        if (totalCurrent > 0 && totalCurrent <= 230) {
          console.log(`     ⚠️  Warning: Parallel run for ${totalCurrent}A total (should use single 4/0 AWG for ≤230A)`);
        }
      });
    }

    // Check AC loads have ground wires
    const acLoads = components.filter(c => c.type === 'ac-load');
    if (acLoads.length > 0) {
      acLoads.forEach(load => {
        const loadWires = result.wires.filter(w => 
          w.toComponentId === load.id || w.fromComponentId === load.id
        );
        const hasHot = loadWires.some(w => w.polarity === 'hot');
        const hasNeutral = loadWires.some(w => w.polarity === 'neutral');
        const hasGround = loadWires.some(w => w.polarity === 'ground');
        const hotWire = loadWires.find(w => w.polarity === 'hot');
        const groundWire = loadWires.find(w => w.polarity === 'ground');
        
        console.log(`   AC Load "${load.name}":`);
        console.log(`     Hot: ${hasHot ? '✓' : '✗'}, Neutral: ${hasNeutral ? '✓' : '✗'}, Ground: ${hasGround ? '✓' : '✗'}`);
        if (hotWire && groundWire) {
          const gaugeMatch = hotWire.gauge === groundWire.gauge;
          console.log(`     Ground gauge matches hot: ${gaugeMatch ? '✓' : '✗'} (hot: ${hotWire.gauge}, ground: ${groundWire.gauge})`);
        }
      });
    }

    // Check component connectivity
    const componentIds = new Set(components.map(c => c.id));
    const connectedComponents = new Set();
    result.wires.forEach(w => {
      connectedComponents.add(w.fromComponentId);
      connectedComponents.add(w.toComponentId);
    });
    const connectivity = (connectedComponents.size / componentIds.size * 100).toFixed(1);
    console.log(`   Component connectivity: ${connectivity}% (${connectedComponents.size}/${componentIds.size})`);

    testResults.push(testResult);
    return testResult;

  } catch (error) {
    const errorMsg = error.message || error.toString();
    const errorStack = error.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : '';
    console.error(`\n❌ TEST FAILED: ${errorMsg}${errorStack}`);
    testResults.push({
      name: testName,
      success: false,
      error: errorMsg,
      duration: Date.now() - startTime
    });
    return null;
  }
}

/**
 * Test Case 1: Simple solar system
 */
async function testSimpleSolar() {
  return await runTest('Simple Solar System', [
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
  ]);
}

/**
 * Test Case 2: AC system with ground gauge matching
 */
async function testACSystem() {
  return await runTest('AC System with Ground Matching', [
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
  ]);
}

/**
 * Test Case 3: Fix existing wires with errors
 */
async function testFixExistingWires() {
  const existingWires = [
    {
      id: 'wire-1',
      fromComponentId: 'battery-1',
      toComponentId: 'inverter-1',
      fromTerminal: 'positive',
      toTerminal: 'dc-positive',
      polarity: 'positive',
      gauge: '10 AWG', // Too small
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
    // Missing ground wire
  ];

  return await runTest('Fix Existing Wires', [
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
  ], existingWires);
}

/**
 * Test Case 4: Complex system
 */
async function testComplexSystem() {
  return await runTest('Complex Multi-Component System', [
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
  ]);
}

/**
 * Test Case 5: Iteration improvement tracking
 */
async function testIterationImprovement() {
  return await runTest('Iteration Improvement', [
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
  ]);
}

/**
 * Test Case 6: High current requiring 4/0 AWG (should use single 4/0, not parallel)
 */
async function testHighCurrentSingle4_0() {
  return await runTest('High Current - Single 4/0 AWG', [
    {
      id: 'battery-1',
      type: 'battery',
      name: 'House Battery',
      x: 200,
      y: 400,
      properties: { voltage: 12, capacity: 800 }
    },
    {
      id: 'inverter-1',
      type: 'inverter',
      name: 'Inverter 3kW',
      x: 500,
      y: 400,
      properties: { powerRating: 3000 }
    },
    {
      id: 'ac-load-1',
      type: 'ac-load',
      name: 'AC Load',
      x: 800,
      y: 400,
      properties: { watts: 2500, acVoltage: 120 }
    }
  ]);
}

/**
 * Test Case 7: Very high current requiring parallel 4/0 AWG (>230A)
 */
async function testVeryHighCurrentParallel4_0() {
  return await runTest('Very High Current - Parallel 4/0 AWG', [
    {
      id: 'battery-1',
      type: 'battery',
      name: 'House Battery',
      x: 200,
      y: 400,
      properties: { voltage: 12, capacity: 1000 }
    },
    {
      id: 'inverter-1',
      type: 'inverter',
      name: 'Inverter 5kW',
      x: 500,
      y: 400,
      properties: { powerRating: 5000 }
    },
    {
      id: 'ac-load-1',
      type: 'ac-load',
      name: 'AC Load 1',
      x: 800,
      y: 400,
      properties: { watts: 3000, acVoltage: 120 }
    },
    {
      id: 'ac-load-2',
      type: 'ac-load',
      name: 'AC Load 2',
      x: 800,
      y: 500,
      properties: { watts: 2000, acVoltage: 120 }
    }
  ]);
}

/**
 * Test Case 8: Medium current - should use single larger gauge, not parallel
 */
async function testMediumCurrentSingleGauge() {
  return await runTest('Medium Current - Single Larger Gauge', [
    {
      id: 'battery-1',
      type: 'battery',
      name: 'House Battery',
      x: 200,
      y: 400,
      properties: { voltage: 12, capacity: 400 }
    },
    {
      id: 'busbar-pos',
      type: 'busbar-positive',
      name: 'Positive Bus Bar',
      x: 400,
      y: 400,
      properties: {}
    },
    {
      id: 'dc-load-1',
      type: 'dc-load',
      name: 'DC Load 1',
      x: 600,
      y: 400,
      properties: { watts: 1200 }
    },
    {
      id: 'dc-load-2',
      type: 'dc-load',
      name: 'DC Load 2',
      x: 600,
      y: 500,
      properties: { watts: 800 }
    }
  ]);
}

/**
 * Print final summary
 */
function printSummary() {
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));

  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.success).length;
  const failedTests = totalTests - passedTests;

  console.log(`\nTotal Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} ✅`);
  console.log(`Failed: ${failedTests} ${failedTests > 0 ? '❌' : ''}`);

  if (totalTests > 0) {
    const avgDuration = testResults.reduce((sum, r) => sum + (r.duration || 0), 0) / totalTests;
    const avgIterations = testResults
      .filter(r => r.iterations)
      .reduce((sum, r) => sum + r.iterations, 0) / testResults.filter(r => r.iterations).length;
    const avgQuality = testResults
      .filter(r => r.qualityScore)
      .reduce((sum, r) => sum + r.qualityScore, 0) / testResults.filter(r => r.qualityScore).length;

    console.log(`\nAverage Duration: ${avgDuration.toFixed(0)}ms`);
    console.log(`Average Iterations: ${avgIterations.toFixed(1)}`);
    console.log(`Average Quality Score: ${avgQuality.toFixed(1)}/100`);

    // Find common issues
    const allErrors = testResults.flatMap(r => r.errors || []);
    const errorCounts = {};
    allErrors.forEach(e => {
      errorCounts[e] = (errorCounts[e] || 0) + 1;
    });

    if (Object.keys(errorCounts).length > 0) {
      console.log(`\n🔍 COMMON ERRORS:`);
      Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([error, count]) => {
          console.log(`   ${count}x: ${error}`);
        });
    }

    const allWireWarnings = testResults.flatMap(r => r.wireWarnings || []);
    const warningCounts = {};
    allWireWarnings.forEach(w => {
      warningCounts[w] = (warningCounts[w] || 0) + 1;
    });

    if (Object.keys(warningCounts).length > 0) {
      console.log(`\n⚠️  COMMON WIRE WARNINGS:`);
      Object.entries(warningCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([warning, count]) => {
          console.log(`   ${count}x: ${warning}`);
        });
    }
  }

  console.log('\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Starting AI Wiring Functional Tests');
  console.log(`API URL: ${API_URL}`);
  console.log(`OpenAI Model: gpt-5.2-chat-latest`);

  try {
    // Check if server is running by trying a simple request
    try {
      const testReq = await fetch(`${API_URL}/api/ai-wire-components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: [] }),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      // Even if it fails with 400, server is responding
      console.log('✓ Server is reachable\n');
    } catch (err) {
      console.warn('⚠️  Warning: Could not reach API server. Make sure it\'s running on', API_URL);
      console.warn(`   Error: ${err.message}`);
      console.warn('   Start server with: npm run dev');
      console.warn('   Or test will fail when making actual requests.\n');
    }

    // Run all tests
    await testSimpleSolar();
    await testACSystem();
    await testFixExistingWires();
    await testComplexSystem();
    await testIterationImprovement();
    await testHighCurrentSingle4_0();
    await testVeryHighCurrentParallel4_0();
    await testMediumCurrentSingleGauge();

    // Print summary
    printSummary();

    // Exit with appropriate code
    const allPassed = testResults.every(r => r.success);
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test runner failed:', error);
    process.exit(1);
  }
}

// Run tests
main();


