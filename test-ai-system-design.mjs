#!/usr/bin/env node
/**
 * AI System Design Test Script
 * Tests the same endpoint the GUI uses and logs each iteration
 */

const API_URL = 'http://127.0.0.1:5000';

async function testSystemDesign(prompt, systemVoltage = 12) {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 AI SYSTEM DESIGN TEST');
  console.log('='.repeat(80));
  console.log(`\nPrompt: "${prompt}"`);
  console.log(`System Voltage: ${systemVoltage}V`);
  console.log('');

  const startTime = Date.now();

  try {
    // Call the iterative endpoint (non-streaming, easier to debug)
    console.log('Calling /api/ai-generate-system-iterative...\n');
    
    const response = await fetch(`${API_URL}/api/ai-generate-system-iterative`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        systemVoltage,
        minQualityScore: 70,
        maxIterations: 6,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const finalResult = await response.json();
    const duration = Date.now() - startTime;
    const iterationCount = finalResult.finalIteration || 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(80));
    
    if (finalResult) {
      console.log(`\nTotal Duration: ${(duration / 1000).toFixed(1)}s`);
      console.log(`Iterations Used: ${finalResult.finalIteration || iterationCount}`);
      console.log(`Final Score: ${finalResult.validation?.score || 'N/A'}/100`);
      console.log(`Achieved Quality Threshold: ${finalResult.achievedQualityThreshold ? 'Yes ✅' : 'No ❌'}`);
      
      // Analyze components
      if (finalResult.components) {
        console.log(`\n📦 COMPONENTS (${finalResult.components.length}):`);
        finalResult.components.forEach((c, i) => {
          const props = c.properties || {};
          const propsStr = Object.keys(props).length > 0 
            ? ` - ${JSON.stringify(props)}`
            : ' - ⚠️  NO PROPERTIES';
          console.log(`   ${i + 1}. ${c.name} (${c.type})${propsStr}`);
        });
        
        // Check for missing properties
        const missingProps = finalResult.components.filter(c => {
          if (c.type === 'solar-panel' && (!c.properties?.watts || !c.properties?.voltage)) return true;
          if (c.type === 'battery' && (!c.properties?.capacity || !c.properties?.voltage)) return true;
          if (c.type === 'cerbo' && !c.properties?.voltage) return true;
          if (c.type === 'dc-load' && !c.properties?.watts) return true;
          if (c.type === 'ac-load' && !c.properties?.watts) return true;
          return false;
        });
        
        if (missingProps.length > 0) {
          console.log(`\n   ⚠️  COMPONENTS MISSING PROPERTIES:`);
          missingProps.forEach(c => {
            console.log(`      - ${c.name} (${c.type})`);
          });
        }
      }
      
      // Analyze wires
      if (finalResult.wires) {
        console.log(`\n🔌 WIRES (${finalResult.wires.length}):`);
        
        // Check for Cerbo connection
        const cerbo = finalResult.components?.find(c => c.type === 'cerbo');
        if (cerbo) {
          const cerboWires = finalResult.wires.filter(w => 
            w.fromComponentId === cerbo.id || w.toComponentId === cerbo.id
          );
          if (cerboWires.length === 0) {
            console.log(`   ⚠️  CERBO NOT CONNECTED!`);
          } else {
            console.log(`   ✅ Cerbo has ${cerboWires.length} wire(s) connected`);
            cerboWires.forEach(w => {
              const from = finalResult.components.find(c => c.id === w.fromComponentId)?.name || w.fromComponentId;
              const to = finalResult.components.find(c => c.id === w.toComponentId)?.name || w.toComponentId;
              console.log(`      - ${from} (${w.fromTerminal}) → ${to} (${w.toTerminal})`);
            });
          }
        }
        
        // Check for orphaned components
        const connectedIds = new Set();
        finalResult.wires.forEach(w => {
          connectedIds.add(w.fromComponentId);
          connectedIds.add(w.toComponentId);
        });
        
        const orphaned = finalResult.components?.filter(c => !connectedIds.has(c.id)) || [];
        if (orphaned.length > 0) {
          console.log(`\n   ⚠️  ORPHANED COMPONENTS (not connected):`);
          orphaned.forEach(c => {
            console.log(`      - ${c.name} (${c.type})`);
          });
        }
        
        // Show sample wires
        console.log(`\n   Sample wires:`);
        finalResult.wires.slice(0, 5).forEach((w, i) => {
          const from = finalResult.components?.find(c => c.id === w.fromComponentId)?.name || w.fromComponentId;
          const to = finalResult.components?.find(c => c.id === w.toComponentId)?.name || w.toComponentId;
          console.log(`   ${i + 1}. ${from} → ${to} | ${w.gauge} | ${w.length}ft | ${w.polarity}`);
        });
        if (finalResult.wires.length > 5) {
          console.log(`   ... and ${finalResult.wires.length - 5} more wires`);
        }
      }
      
      // Analyze validation issues
      if (finalResult.validation?.issues) {
        const errors = finalResult.validation.issues.filter(i => i.severity === 'error');
        const warnings = finalResult.validation.issues.filter(i => i.severity === 'warning');
        
        console.log(`\n🔍 FINAL VALIDATION:`);
        console.log(`   Total Errors: ${errors.length}`);
        console.log(`   Total Warnings: ${warnings.length}`);
        
        // Show ALL errors
        if (errors.length > 0) {
          console.log(`\n   ❌ ALL ERRORS:`);
          errors.forEach((e, i) => {
            console.log(`      ${i + 1}. [${e.category}] ${e.message}`);
            if (e.wireId) {
              const wire = finalResult.wires?.find(w => w.id === e.wireId);
              if (wire) {
                const from = finalResult.components?.find(c => c.id === wire.fromComponentId)?.name || wire.fromComponentId;
                const to = finalResult.components?.find(c => c.id === wire.toComponentId)?.name || wire.toComponentId;
                console.log(`         Wire: ${from} (${wire.fromTerminal}) → ${to} (${wire.toTerminal}) | ${wire.gauge} | ${wire.polarity}`);
              }
            }
            if (e.suggestion) console.log(`         → ${e.suggestion}`);
          });
        }
        
        // Show ALL warnings with wire details
        if (warnings.length > 0) {
          console.log(`\n   ⚠️  ALL WARNINGS:`);
          warnings.forEach((w, i) => {
            console.log(`      ${i + 1}. [${w.category}] ${w.message}`);
            if (w.wireId) {
              const wire = finalResult.wires?.find(wr => wr.id === w.wireId);
              if (wire) {
                const from = finalResult.components?.find(c => c.id === wire.fromComponentId)?.name || wire.fromComponentId;
                const to = finalResult.components?.find(c => c.id === wire.toComponentId)?.name || wire.toComponentId;
                console.log(`         Wire: ${from} (${wire.fromTerminal}) → ${to} (${wire.toTerminal}) | ${wire.gauge} | ${wire.polarity}`);
              }
            }
            if (w.suggestion) console.log(`         → ${w.suggestion}`);
          });
        }
      }
      
      // Iteration history
      if (finalResult.iterationHistory) {
        console.log(`\n📈 ITERATION HISTORY:`);
        finalResult.iterationHistory.forEach(h => {
          console.log(`   Iteration ${h.iteration}: Score ${h.score}, Errors ${h.errorCount}, Warnings ${h.warningCount}`);
        });
      }
      
    } else {
      console.log('\n❌ No final result received');
    }
    
    console.log('\n' + '='.repeat(80));
    
    return finalResult;
    
  } catch (error) {
    console.error(`\n❌ TEST FAILED: ${error.message}`);
    console.error(error.stack);
    return null;
  }
}

// Run the test
async function main() {
  // Check server is reachable
  try {
    const healthCheck = await fetch(`${API_URL}/api/validate-design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ components: [], wires: [], systemVoltage: 12 }),
      signal: AbortSignal.timeout(5000),
    });
    console.log('✓ Server is reachable');
  } catch (err) {
    console.error(`\n⚠️  Warning: Could not reach API server at ${API_URL}`);
    console.error(`   Error: ${err.message}`);
    console.error(`   Make sure the server is running: npm run dev`);
    console.error('');
  }

  // Run the marine power system test
  const prompt = process.argv[2] || "Setup a marine power system for a 40ft boat with shore power";
  const voltage = parseInt(process.argv[3]) || 12;
  
  await testSystemDesign(prompt, voltage);
}

main().catch(console.error);


