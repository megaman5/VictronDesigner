import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Benchmark playground CLI - `npm run bench -- <command>`.
 *
 * This is the code/CLI-only face of the benchmark harness: it runs on the box,
 * talks to the same DB tables as the admin API, and needs no session cookie -
 * which is what lets an AI assistant drive it directly.
 *
 * The .env is root-owned on production checkouts, so this loads it manually
 * and says "use sudo" instead of failing with a bare EACCES.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnv(): void {
  const envPath = path.join(projectRoot, ".env");
  let raw: string;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch (err: any) {
    if (err?.code === "EACCES") {
      console.error(`Cannot read ${envPath} (permission denied). Run via: sudo npm run bench -- <command>`);
      process.exit(1);
    }
    if (process.env.DATABASE_URL) return; // env supplied some other way
    console.error(`Cannot read ${envPath}: ${err?.message}`);
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// tiny arg parsing: positionals + --flag / --flag value
// ---------------------------------------------------------------------------

interface Args {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: string | boolean | undefined): number | undefined => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : undefined;
};
const list = (v: string | boolean | undefined): string[] | undefined =>
  str(v)
    ?.split(",")
    .map(s => s.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------

function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = [headers, ...rows.map(r => r.map(c => (c === null || c === undefined ? "-" : String(c))))];
  const widths = headers.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  return cells
    .map((r, idx) => {
      const line = r.map((c, i) => c.padEnd(widths[i])).join("  ");
      return idx === 0 ? `${line}\n${widths.map(w => "-".repeat(w)).join("  ")}` : line;
    })
    .join("\n");
}

const money = (v: unknown): string =>
  v === null || v === undefined ? "-" : `$${Number(v).toFixed(4)}`;
const fixed = (v: unknown, dp = 1): string =>
  v === null || v === undefined ? "-" : Number(v).toFixed(dp);

const HELP = `VictronDesigner AI benchmark playground

Usage: npm run bench -- <command> [options]
(a production checkout needs sudo: sudo npm run bench -- <command>)

Commands:
  suites                       List suites, cases, and which providers have keys
  preview --skill <id>         Print a skill's rendered prompt and content hash
  run --suite <id> --model <m> Run a suite against a model (records to DB)
      [--provider openai|openrouter|anthropic|gemini|local] (else inferred from model id)
      [--case a,b] [--repeats N] [--iterations N] [--target-score N]
      [--judge] [--judges m1,m2] [--label text] [--max-output-tokens N]
  list [--limit N]             Recent runs
  show <runId>                 One run with per-case results
  compare <runA> <runB>        Case-by-case diff of two runs
  judge <runId> [--judges ...] Retro-judge a stored run's outputs (no regeneration)
  exemplar --case <id> [--model M | --models a,b,c] [--iterations N] [--judge]
                               Generate a reference design; with --models it
                               tries each and keeps the best (validator score,
                               judge panel breaks ties)
  exemplar --suite <id> --all  Exemplars for every case in a suite
  exemplars                    List stored exemplars
  report [--out file.html]     Self-contained HTML review of every exemplar:
                               rendered drawing, validator issues and judge
                               notes. Add --no-judge to skip the model calls.

Judging uses cheap vision models (default panel: gpt-5-mini, claude-haiku-4-5,
gemini-3.6-flash, filtered to providers with keys in .env). Exemplars default
to claude-fable-5 and need ANTHROPIC_API_KEY.`;

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "help";

  if (command === "help" || flags.help) {
    console.log(HELP);
    return;
  }

  loadEnv();

  // Deferred so .env is loaded before db.ts demands DATABASE_URL.
  const [{ listSuites, getSuite, SUITES }, { getSkill, listSkills, skillFingerprint }, providers, judgeMod, service, { benchmarkStorage }, runnerMod] =
    await Promise.all([
      import("./cases"),
      import("../skills"),
      import("../providers"),
      import("./judge"),
      import("./service"),
      import("./storage"),
      import("./runner"),
    ]);

  const printResultLine = (r: import("./runner").CaseResult) => {
    const status = r.success ? (r.expectationsMet === false ? "EXPECT-FAIL" : "ok") : "ERROR";
    const judge = r.judgeScore !== null ? ` judge=${r.judgeScore}` : "";
    console.log(
      `  ${r.caseId}#${r.repeat}: ${status} score=${r.score ?? "-"}${judge} repairs=${r.repairCount ?? "-"} iters=${r.iterationsUsed} ${money(r.costUsd)} ${(r.durationMs / 1000).toFixed(1)}s${r.errorMessage ? ` (${r.errorMessage})` : ""}`
    );
  };

  // `list` prints 8-char ids, so every command that takes a run id accepts a
  // unique prefix as well as the full UUID.
  const resolveRunId = async (value: string | undefined, cmd: string): Promise<string> => {
    const id = requireRunId(value, cmd);
    if (id.length >= 36) return id;
    const matches = (await benchmarkStorage.listRuns(200)).filter(r => r.id.startsWith(id));
    if (matches.length === 1) return matches[0].id;
    console.error(
      matches.length === 0 ? `No run starts with "${id}"` : `"${id}" is ambiguous (${matches.length} matches)`
    );
    process.exit(1);
  };

  switch (command) {
    case "suites": {
      console.log("Suites:");
      for (const s of listSuites()) {
        console.log(`  ${s.id} (skill: ${s.skillId}) - ${s.label}`);
        console.log(`    cases: ${s.caseIds.join(", ")}`);
      }
      console.log("\nSkills:");
      for (const s of listSkills()) {
        console.log(`  ${s.id} v${s.version} hash=${skillFingerprint(getSkill(s.id))}`);
      }
      console.log("\nProviders:");
      for (const p of providers.describeProviders()) {
        console.log(`  ${p.id}: ${p.hasPlatformKey ? "key available" : "NO KEY"}`);
      }
      console.log(`\nDefault judge panel: ${judgeMod.DEFAULT_JUDGE_MODELS.join(", ")}`);
      console.log(`Callable judges now:  ${judgeMod.availableJudges().join(", ") || "(none)"}`);
      return;
    }

    case "preview": {
      const skill = getSkill(str(flags.skill) ?? "system-design");
      const ctx = { systemVoltage: num(flags.voltage) ?? 12 };
      console.log(`# skill ${skill.id} v${skill.version} hash=${skillFingerprint(skill)}\n`);
      console.log("## System prompt\n");
      console.log(skill.buildSystemPrompt(ctx));
      console.log("\n## User prompt wrapper (for prompt 'EXAMPLE')\n");
      console.log(skill.buildUserPrompt("EXAMPLE", ctx));
      return;
    }

    case "run": {
      const suiteId = str(flags.suite);
      const model = str(flags.model);
      if (!suiteId || !model) {
        console.error("run needs --suite and --model. See: npm run bench -- suites");
        process.exit(1);
      }
      if (!providers.isPriced(model)) {
        console.warn(`Note: ${model} has no price entry - cost will be reported as null.`);
      }
      const judges = list(flags.judges);
      const wantJudge = Boolean(flags.judge) || Boolean(judges?.length);
      console.log(`Running ${suiteId} on ${model}${wantJudge ? " with judging" : ""}...`);

      const { runId, summary } = await service.runBenchmarkToCompletion(
        {
          suiteId,
          model,
          providerId: str(flags.provider) as import("../providers").ProviderId | undefined,
          caseIds: list(flags.case),
          repeats: num(flags.repeats) ?? 1,
          iterations: num(flags.iterations) ?? 1,
          targetScore: num(flags["target-score"]),
          maxOutputTokens: num(flags["max-output-tokens"]),
          judge: wantJudge,
          judges,
          label: str(flags.label),
          triggeredBy: "cli",
        },
        printResultLine
      );

      const s = summary.stats;
      console.log(`\nRun ${runId}`);
      console.log(
        `  skill ${summary.skill.id} v${summary.skill.version} | model ${summary.model} (${summary.providerId})`
      );
      console.log(
        `  validator: mean ${fixed(s.meanScore)} median ${fixed(s.medianScore)} stddev ${fixed(s.scoreStdDev)} | pass ${fixed(s.passRate)}%`
      );
      if (s.meanJudgeScore !== null) {
        console.log(`  judge:     mean ${fixed(s.meanJudgeScore)} | judge cost ${money(s.totalJudgeCostUsd)}`);
      }
      console.log(
        `  tokens ${s.totalInputTokens} in / ${s.totalOutputTokens} out | generation cost ${money(s.totalCostUsd)} | repairs ${s.totalRepairs}`
      );
      return;
    }

    case "list": {
      const runs = await benchmarkStorage.listRuns(num(flags.limit) ?? 20);
      console.log(
        table(
          ["run", "when", "suite", "model", "skill", "hash", "mean", "judge", "pass%", "cost", "status", "label"],
          runs.map(r => [
            r.id.slice(0, 8),
            r.startedAt?.toISOString().slice(0, 16).replace("T", " "),
            r.suiteId,
            r.model,
            r.skillVersion,
            r.promptHash ? r.promptHash.slice(0, 8) : null,
            r.meanScore,
            r.meanJudgeScore,
            r.passRate,
            r.totalCostUsd === null ? null : money(r.totalCostUsd),
            r.status,
            r.label,
          ])
        )
      );
      return;
    }

    case "show": {
      const found = await benchmarkStorage.getRun(await resolveRunId(positional[1], "show"));
      if (!found) {
        console.error("Run not found");
        process.exit(1);
      }
      const { run, results } = found;
      console.log(
        `Run ${run.id}\n  ${run.suiteId} | ${run.model} (${run.provider}) | skill ${run.skillId} v${run.skillVersion} hash=${run.promptHash ?? "-"}\n  git ${run.gitRev ?? "-"}${run.gitDirty ? " (dirty)" : ""} | status ${run.status} | label ${run.label ?? "-"}\n  judges: ${Array.isArray(run.judges) ? (run.judges as string[]).join(", ") : "-"}`
      );
      console.log(
        table(
          ["case", "rep", "ok", "score", "judge", "±", "expect", "repairs", "iters", "cost", "judge cost", "secs"],
          results.map(r => [
            r.caseId,
            r.repeat,
            r.success ? "y" : "n",
            r.score,
            r.judgeScore,
            r.judgeStdDev,
            r.expectationsMet === null ? null : r.expectationsMet ? "met" : "FAILED",
            r.repairCount,
            r.iterationsUsed,
            r.costUsd === null ? null : money(r.costUsd),
            r.judgeCostUsd === null ? null : money(r.judgeCostUsd),
            r.durationMs === null ? null : (r.durationMs / 1000).toFixed(1),
          ])
        )
      );
      for (const r of results) {
        const failed = (r.failedExpectations as string[] | null) ?? [];
        if (failed.length) console.log(`  ${r.caseId}#${r.repeat} failed expectations: ${failed.join("; ")}`);
        if (r.errorMessage) console.log(`  ${r.caseId}#${r.repeat} error: ${r.errorMessage}`);
        const details = r.judgeDetails as any;
        if (details?.verdicts) {
          for (const v of details.verdicts) {
            console.log(
              `  ${r.caseId}#${r.repeat} judge ${v.model}: ${v.ok ? v.overall : `ERROR ${v.error}`}${v.notes ? ` - ${v.notes}` : ""}`
            );
          }
          if (details.lowConfidence) console.log(`  ${r.caseId}#${r.repeat} judge verdict is LOW CONFIDENCE`);
        }
      }
      return;
    }

    case "compare": {
      const a = await benchmarkStorage.getRun(await resolveRunId(positional[1], "compare"));
      const b = await benchmarkStorage.getRun(await resolveRunId(positional[2], "compare"));
      if (!a || !b) {
        console.error("One or both runs not found");
        process.exit(1);
      }
      console.log(`A: ${a.run.id.slice(0, 8)} ${a.run.model} skill v${a.run.skillVersion} hash=${a.run.promptHash ?? "-"} label=${a.run.label ?? "-"}`);
      console.log(`B: ${b.run.id.slice(0, 8)} ${b.run.model} skill v${b.run.skillVersion} hash=${b.run.promptHash ?? "-"} label=${b.run.label ?? "-"}`);
      if (a.run.promptHash && b.run.promptHash) {
        console.log(
          a.run.promptHash === b.run.promptHash
            ? "Prompts are identical (same content hash)."
            : "Prompts DIFFER (content hash changed)."
        );
      }

      const caseMean = (results: typeof a.results, key: "score" | "judgeScore") => {
        const byCase = new Map<string, number[]>();
        for (const r of results) {
          const v = r[key];
          if (typeof v === "number") {
            byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), v]);
          }
        }
        return (caseId: string) => {
          const xs = byCase.get(caseId);
          return xs?.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
        };
      };

      const aScore = caseMean(a.results, "score");
      const bScore = caseMean(b.results, "score");
      const aJudge = caseMean(a.results, "judgeScore");
      const bJudge = caseMean(b.results, "judgeScore");
      const caseIds = Array.from(new Set([...a.results, ...b.results].map(r => r.caseId)));

      const delta = (x: number | null, y: number | null) =>
        x === null || y === null ? null : `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(1)}`;

      console.log(
        "\n" +
          table(
            ["case", "A score", "B score", "Δ", "A judge", "B judge", "Δ"],
            caseIds.map(id => [
              id,
              fixed(aScore(id)),
              fixed(bScore(id)),
              delta(aScore(id), bScore(id)),
              fixed(aJudge(id)),
              fixed(bJudge(id)),
              delta(aJudge(id), bJudge(id)),
            ])
          )
      );
      console.log(
        `\nTotals: validator ${fixed(a.run.meanScore)} -> ${fixed(b.run.meanScore)} | judge ${fixed(a.run.meanJudgeScore)} -> ${fixed(b.run.meanJudgeScore)} | cost ${money(a.run.totalCostUsd)} -> ${money(b.run.totalCostUsd)}`
      );
      return;
    }

    case "judge": {
      const found = await benchmarkStorage.getRun(await resolveRunId(positional[1], "judge"));
      if (!found) {
        console.error("Run not found");
        process.exit(1);
      }
      const { run, results } = found;
      const judges = list(flags.judges) ?? judgeMod.availableJudges();
      if (!judges.length) {
        console.error("No callable judge models - add provider keys to .env");
        process.exit(1);
      }
      const suite = getSuite(run.suiteId);
      const exemplars = await benchmarkStorage.exemplarsByCase();
      console.log(`Judging ${results.length} result(s) with: ${judges.join(", ")}`);

      let judgedCount = 0;
      for (const r of results) {
        const design = r.output as any;
        const testCase = suite.cases.find(c => c.id === r.caseId);
        if (!r.success || !design?.components?.length || !testCase) {
          console.log(`  ${r.caseId}#${r.repeat}: skipped (no stored output or unknown case)`);
          continue;
        }
        const panel = await judgeMod.judgeDesign({
          design,
          prompt: testCase.prompt,
          systemVoltage: testCase.systemVoltage,
          exemplar: exemplars[r.caseId] ?? null,
          judges,
        });
        await benchmarkStorage.recordJudgement(r.id, panel);
        judgedCount++;
        console.log(
          `  ${r.caseId}#${r.repeat}: judge=${panel.score ?? "-"} stddev=${fixed(panel.stdDev)}${panel.lowConfidence ? " LOW-CONFIDENCE" : ""} ${money(panel.costUsd)}`
        );
      }
      await benchmarkStorage.refreshRunJudgeStats(run.id, judges);
      console.log(`Judged ${judgedCount} result(s); run aggregates updated.`);
      return;
    }

    case "exemplar": {
      // A reference design is worth generating several ways and keeping the
      // best - it is written once and then anchors every judge panel after it.
      const models = list(flags.models) ?? [str(flags.model) ?? "claude-fable-5"];
      const iterations = num(flags.iterations) ?? 3;
      const wantJudge = Boolean(flags.judge);
      let targets: { suiteId: string; caseId: string }[];

      if (flags.all) {
        const suiteId = str(flags.suite);
        if (!suiteId) {
          console.error("exemplar --all needs --suite");
          process.exit(1);
        }
        targets = getSuite(suiteId).cases.map(c => ({ suiteId, caseId: c.id }));
      } else {
        const caseId = str(flags.case);
        if (!caseId) {
          console.error("exemplar needs --case <id> (or --suite <id> --all)");
          process.exit(1);
        }
        const suiteEntry = Object.values(SUITES).find(s => s.cases.some(c => c.id === caseId));
        if (!suiteEntry) {
          console.error(`No suite contains case "${caseId}"`);
          process.exit(1);
        }
        targets = [{ suiteId: suiteEntry.id, caseId }];
      }

      const judges = wantJudge ? judgeMod.availableJudges() : [];

      for (const t of targets) {
        console.log(`\n${t.caseId}: trying ${models.length} model(s), ${iterations} iteration(s) max`);
        const testCase = getSuite(t.suiteId).cases.find(c => c.id === t.caseId)!;

        let best: {
          model: string;
          score: number;
          judgeScore: number | null;
          design: any;
          costUsd: number | null;
        } | null = null;
        let spent = 0;

        for (const m of models) {
          let r: import("./runner").CaseResult | undefined;
          try {
            // Straight through the runner, but never recorded as a benchmark
            // run - an exemplar is a reference artifact, not a measurement.
            const summary = await runnerMod.runBenchmark({
              suiteId: t.suiteId,
              caseIds: [t.caseId],
              model: m,
              iterations,
              targetScore: 95,
            });
            r = summary.results[0];
          } catch (err: any) {
            console.log(`  ${m.padEnd(34)} FAILED: ${err?.message ?? err}`);
            continue;
          }
          if (!r?.success || !r.output) {
            console.log(`  ${m.padEnd(34)} FAILED: ${r?.errorMessage ?? "no output"}`);
            continue;
          }
          if (typeof r.costUsd === "number") spent += r.costUsd;

          // Judge only the designs that could actually win, so a weak model
          // does not cost a panel call.
          let judgeScore: number | null = null;
          if (judges.length && (!best || (r.score ?? 0) >= best.score)) {
            try {
              const panel = await judgeMod.judgeDesign({
                design: r.output as any,
                prompt: testCase.prompt,
                systemVoltage: testCase.systemVoltage,
                judges,
              });
              judgeScore = panel.score;
              if (typeof panel.costUsd === "number") spent += panel.costUsd;
            } catch (err: any) {
              console.warn(`  (judging ${m} failed: ${err?.message})`);
            }
          }

          console.log(
            `  ${m.padEnd(34)} validator=${String(r.score).padStart(3)} judge=${judgeScore ?? "-"} ${String(r.componentCount).padStart(2)}c/${String(r.wireCount).padStart(2)}w ${money(r.costUsd)}`
          );

          // Validator score decides; the judge panel breaks ties, since two
          // electrically-clean designs still differ in layout quality.
          const better =
            !best ||
            (r.score ?? 0) > best.score ||
            ((r.score ?? 0) === best.score && (judgeScore ?? -1) > (best.judgeScore ?? -1));
          if (better) {
            best = {
              model: m,
              score: r.score ?? 0,
              judgeScore,
              design: r.output as any,
              costUsd: r.costUsd,
            };
          }
        }

        if (!best) {
          console.error(`  no model produced a usable design for ${t.caseId}`);
          continue;
        }

        await benchmarkStorage.saveExemplar({
          caseId: t.caseId,
          suiteId: t.suiteId,
          model: best.model,
          validatorScore: best.score,
          design: best.design,
          notes: best.judgeScore !== null ? `judge panel median ${best.judgeScore}` : null,
          createdBy: "cli",
        });
        console.log(
          `  -> kept ${best.model} (validator ${best.score}${best.judgeScore !== null ? `, judge ${best.judgeScore}` : ""}); case spend ${money(spent)}`
        );
        if (best.score < 85) {
          console.warn(`  WARNING: ${best.score} is low for a reference - raise --iterations or add models`);
        }
      }
      return;
    }

    case "report": {
      const out = str(flags.out) ?? "exemplar-report.html";
      const wantJudge = flags.judge !== false && !flags["no-judge"];
      const reportMod = await import("./report");
      console.log(`Building report${wantJudge ? " (judging each exemplar)" : ""}...`);
      const rows = await reportMod.collectExemplarReport({
        judge: wantJudge,
        judges: list(flags.judges),
      });
      if (!rows.length) {
        console.error("No exemplars stored - run: npm run bench -- exemplar --suite core-designs --all");
        process.exit(1);
      }
      fs.writeFileSync(out, reportMod.renderExemplarReportHtml(rows));
      for (const r of rows) {
        console.log(
          `  ${r.caseId.padEnd(20)} ${r.model.padEnd(32)} validator=${String(r.validatorScore).padStart(3)} judge=${r.panel?.score ?? "-"}${r.panel?.lowConfidence ? " (low-conf)" : ""}`
        );
      }
      console.log(`\nWrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, self-contained - open it in a browser)`);
      return;
    }

    case "exemplars": {
      const rows = await benchmarkStorage.listExemplars();
      if (!rows.length) {
        console.log("No exemplars stored. Create one: npm run bench -- exemplar --case van-12v");
        return;
      }
      console.log(
        table(
          ["case", "suite", "model", "validator", "created"],
          rows.map(r => [
            r.caseId,
            r.suiteId,
            r.model,
            r.validatorScore,
            r.createdAt?.toISOString().slice(0, 10),
          ])
        )
      );
      return;
    }

    default:
      console.error(`Unknown command "${command}"\n`);
      console.log(HELP);
      process.exit(1);
  }
}

function requireRunId(value: string | undefined, cmd: string): string {
  if (!value) {
    console.error(`${cmd} needs a run id (see: npm run bench -- list)`);
    process.exit(1);
  }
  return value;
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
