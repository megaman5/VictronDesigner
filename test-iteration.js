#!/usr/bin/env node

/**
 * Test script for AI iterative generation endpoint
 * Usage: node test-iteration.js "your prompt here"
 */

const prompt = process.argv[2] || "12V battery with solar panel and DC load";
const systemVoltage = 12;
const minQualityScore = 70;
const maxIterations = 5;

console.log("🧪 Testing AI Iterative Generation");
console.log("━".repeat(60));
console.log(`📝 Prompt: ${prompt}`);
console.log(`⚡ System Voltage: ${systemVoltage}V`);
console.log(`🎯 Min Quality Score: ${minQualityScore}`);
console.log(`🔄 Max Iterations: ${maxIterations}`);
console.log("━".repeat(60));
console.log();

async function testIteration() {
  try {
    console.log("🚀 Sending request to http://localhost:5000/api/ai-generate-system-iterative");
    console.log();

    const startTime = Date.now();

    const response = await fetch("http://localhost:5000/api/ai-generate-system-iterative", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        systemVoltage,
        minQualityScore,
        maxIterations,
      }),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Response received in ${duration}s`);
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    console.log();

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ ERROR Response:");
      console.error(errorText);
      process.exit(1);
    }

    const data = await response.json();

    console.log("✅ SUCCESS");
    console.log("━".repeat(60));
    console.log(`📦 Components: ${data.components?.length || 0}`);
    console.log(`🔌 Wires: ${data.wires?.length || 0}`);
    console.log(`🔁 Final Iteration: ${data.finalIteration}`);
    console.log(`🎯 Achieved Quality Threshold: ${data.achievedQualityThreshold ? "✅ YES" : "⚠️  NO"}`);
    console.log();

    if (data.validation) {
      console.log("📊 VALIDATION RESULTS");
      console.log("━".repeat(60));
      console.log(`Score: ${data.validation.score}/100`);
      console.log(`Valid: ${data.validation.valid ? "✅" : "❌"}`);
      console.log(`Issues: ${data.validation.issues?.length || 0}`);

      if (data.validation.issues?.length > 0) {
        console.log();
        console.log("Issues breakdown:");
        const errorCount = data.validation.issues.filter(i => i.severity === 'error').length;
        const warningCount = data.validation.issues.filter(i => i.severity === 'warning').length;
        const infoCount = data.validation.issues.filter(i => i.severity === 'info').length;
        console.log(`  - Errors: ${errorCount}`);
        console.log(`  - Warnings: ${warningCount}`);
        console.log(`  - Info: ${infoCount}`);
      }
      console.log();
    }

    if (data.iterationHistory && data.iterationHistory.length > 0) {
      console.log("📈 ITERATION HISTORY");
      console.log("━".repeat(60));
      data.iterationHistory.forEach((iter, idx) => {
        const emoji = iter.score >= 70 ? "✅" : iter.score >= 50 ? "⚠️ " : "❌";
        console.log(`${emoji} Iteration ${iter.iteration}: Score ${iter.score}/100 (${iter.errorCount} errors, ${iter.warningCount} warnings)`);

        if (iter.topIssues && iter.topIssues.length > 0 && idx === data.iterationHistory.length - 1) {
          console.log();
          console.log("   Top issues in final iteration:");
          iter.topIssues.slice(0, 3).forEach(issue => {
            console.log(`   - [${issue.severity}] ${issue.message}`);
          });
        }
      });
      console.log();
    }

    if (data.description) {
      console.log("📝 DESCRIPTION");
      console.log("━".repeat(60));
      console.log(data.description);
      console.log();
    }

    if (data.recommendations && data.recommendations.length > 0) {
      console.log("💡 RECOMMENDATIONS");
      console.log("━".repeat(60));
      data.recommendations.forEach((rec, idx) => {
        console.log(`${idx + 1}. ${rec}`);
      });
      console.log();
    }

    if (data.visualFeedback) {
      console.log("👁️  VISUAL AI FEEDBACK");
      console.log("━".repeat(60));
      console.log(data.visualFeedback);
      console.log();
    }

    console.log("━".repeat(60));
    console.log("🎉 Test completed successfully!");

  } catch (error) {
    console.error("💥 FATAL ERROR:");
    console.error(error.message);
    console.error();
    console.error("Stack trace:");
    console.error(error.stack);
    process.exit(1);
  }
}

testIteration();
