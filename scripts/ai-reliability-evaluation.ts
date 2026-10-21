import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ path: '/usr/local/victron/.env', quiet: true });
const { runBenchmark } = await import('../server/ai/benchmark/runner');
const out = '/usr/local/victron/docs/benchmarks/ai-reliability-2026-10-05';
await Promise.all([undefined, 'low' as const].map(async reasoningEffort => {
  const profile = reasoningEffort ?? 'default';
  const summary = await runBenchmark({ suiteId: 'ai-regressions', model: 'gemini-3.8-flash', providerId: 'gemini', repeats: 2, iterations: 1, maxOutputTokens: 32000, reasoningEffort, onResult: r => { console.log(JSON.stringify({ profile, caseId:r.caseId, repeat:r.repeat, completed:r.success, electrical:r.electricalPassed, stop:r.stopReason, ms:r.durationMs, error:r.errorMessage })); }});
  fs.writeFileSync(`${out}/${profile}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ profile, stats: summary.stats }));
}));
