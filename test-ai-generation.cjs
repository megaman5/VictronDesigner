// Test script for AI generation with SSE streaming
const http = require('http');

const prompt = "Design a simple 12V RV system with battery, solar panel, and MPPT controller";

const postData = JSON.stringify({
  prompt: prompt,
  systemVoltage: 12,
  minQualityScore: 70,
  maxIterations: 3
});

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/ai-generate-system-stream',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('🚀 Testing AI Generation...');
console.log('Prompt:', prompt);
console.log('Max iterations: 3\n');

const req = http.request(options, (res) => {
  console.log('✅ Connected to server');
  console.log('Status:', res.statusCode);
  console.log('');

  let buffer = '';
  let iterationCount = 0;
  let finalData = null;
  let currentEventType = '';  // Move outside the data handler to persist across chunks

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEventType = line.substring(6).trim();
        continue;
      }

      if (line.startsWith('data:')) {
        try {
          const data = JSON.parse(line.substring(5).trim());

          if (currentEventType === 'iteration-start') {
            iterationCount++;
            console.log(`📊 Iteration ${data.iteration}/${data.maxIterations} started...`);
          } else if (currentEventType === 'iteration-complete') {
            console.log(`   ✓ Score: ${data.score}, Errors: ${data.errorCount}, Warnings: ${data.warningCount}${data.isBest ? ' 🌟 BEST' : ''}`);
          } else if (currentEventType === 'complete') {
            finalData = data;
            console.log('\n🎉 Generation Complete!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('Components:', data.components?.length || 0);
            console.log('Wires:', data.wires?.length || 0);
            console.log('Quality Score:', data.validation?.score || 'N/A');
            console.log('Final Iteration:', data.finalIteration);
            console.log('Achieved Quality Threshold:', data.achievedQualityThreshold);

            if (data.components && data.components.length > 0) {
              console.log('\n📦 Components:');
              data.components.forEach(comp => {
                console.log(`  - ${comp.name} (${comp.type}) at (${comp.x}, ${comp.y})`);
              });
            }

            if (data.wires && data.wires.length > 0) {
              console.log('\n🔌 Wires:');
              data.wires.forEach(wire => {
                console.log(`  - ${wire.fromComponentId} → ${wire.toComponentId} (${wire.gauge}, ${wire.polarity})`);
              });
            }

            if (data.validation && data.validation.issues && data.validation.issues.length > 0) {
              console.log('\n⚠️  Issues:');
              data.validation.issues.forEach(issue => {
                const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
                console.log(`  ${icon} ${issue.message}`);
              });
            }

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          } else if (currentEventType === 'error') {
            console.error('❌ Error:', data.error);
          }

          currentEventType = '';
        } catch (err) {
          // Ignore parsing errors for incomplete data
        }
      }
    }
  });

  res.on('end', () => {
    console.log('✅ Stream ended');

    if (!finalData) {
      console.error('❌ No final data received!');
      process.exit(1);
    }

    if (!finalData.components || finalData.components.length === 0) {
      console.error('❌ No components generated!');
      process.exit(1);
    }

    if (!finalData.wires || finalData.wires.length === 0) {
      console.error('❌ No wires generated!');
      process.exit(1);
    }

    console.log('✅ AI generation test PASSED!');
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
  process.exit(1);
});

req.write(postData);
req.end();
