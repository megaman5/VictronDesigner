/**
 * CLI entry point for the benchmark harness.
 * Usage: npx tsx bench-cli.mts <model> [repeats] [suiteId]
 */
import { runBenchmark } from "./server/ai/benchmark/runner";

const [model = "gpt-5.4", repeatsArg = "1", suiteId = "core-designs"] = process.argv.slice(2);
const repeats = Number(repeatsArg);

const summary = await runBenchmark({
  suiteId,
  model,
  repeats,
  onResult: r => {
    const score = r.score === null ? "  -" : String(r.score).padStart(3);
    const status = r.success ? "ok  " : "FAIL";
    const exp = r.expectationsMet === false ? ` unmet=[${r.failedExpectations.join("; ")}]` : "";
    console.log(
      `${r.caseId.padEnd(22)} #${r.repeat} ${status} score=${score} err=${String(r.errorCount ?? "-").padStart(2)} repairs=${String(r.repairCount ?? "-").padStart(2)} ${(r.durationMs / 1000).toFixed(0)}s${exp}${r.errorMessage ? " " + r.errorMessage.slice(0, 70) : ""}`
    );
  },
});

const s = summary.stats;
console.log("\n=== summary ===");
console.log(`model         ${summary.model} (${summary.providerId}, platformKey=${summary.usingPlatformKey})`);
console.log(`skill         ${summary.skill.id} v${summary.skill.version}`);
console.log(`sampling      applied=${summary.samplingApplied}`);
console.log(`score         mean=${s.meanScore?.toFixed(1)} median=${s.medianScore} min=${s.minScore} max=${s.maxScore} sd=${s.scoreStdDev?.toFixed(1) ?? "n/a"}`);
console.log(`pass rate     ${s.passRate?.toFixed(0)}%  (${s.completedCount} runs)`);
console.log(`repairs       ${s.totalRepairs}`);
console.log(`tokens        in=${s.totalInputTokens} out=${s.totalOutputTokens}`);
console.log(`cost          ${s.totalCostUsd === null ? "unpriced model" : "$" + s.totalCostUsd.toFixed(4)}`);
console.log(`mean latency  ${s.meanDurationMs}ms`);
