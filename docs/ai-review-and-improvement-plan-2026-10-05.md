# AI review and improvement plan

Review date: October 5, 2026. Latest inspected request: 10:12:22 UTC.

## Recommendation

Prioritize honest outcome reporting, preflight checks, and stopping unproductive corrections. Then improve supported electrical analysis and targeted repair. Evaluate model settings after those contracts are reliable: today's simple wiring is already fast, while complex and unresolved circuits remain problematic.

## Evidence and limits

Read-only review of the active application's `ai_logs`, current source, and existing benchmark/testing reports. No paid provider calls, user-design edits, code changes, or deployment were performed. Logs may include testing and retries; counts describe recorded requests, not unique users or a controlled before/after experiment. Historical scores were produced by different code/validator versions and are not directly comparable.

October 2–5 contains 28 requests: 23 completed and 5 failed. Completion is the database `success` flag, not electrical approval. Of 23 completed requests, 15 have the newer electrical status: 12 incomplete, 3 failed, none passed. Eight older completions lack this status and must stay unknown.

| Date (UTC) | Action | Completed / requests | Mean recorded score | Mean duration, all requests |
| --- | --- | --- | --- | --- |
| Oct 2 | Full design / iteration | 7 / 7 | 90.9 | 90.8 s |
| Oct 2 | AI Wire | 7 / 8 | 85.0 | 161.1 s |
| Oct 3 | AI Wire | 1 / 3 | 100 | 14.9 s |
| Oct 4 | AI Wire | 5 / 6 | 98.0 | 63.9 s |
| Oct 5 through latest record | AI Wire | 3 / 4 | 100 | 26.5 s |

Scores exclude null values; failure durations include immediate input rejection. These averages should not be read as typical successful generation latency. No full-design requests are logged after October 2 in this window.

## Successes

- Today's three completed wiring requests took 6.680, 8.310, and 8.270 seconds, each in one pass with zero legacy validator errors. They covered 3, 5, and 6 components. All still have incomplete electrical analysis, so they demonstrate responsive proposal generation rather than verified final designs.
- Correction feedback can improve topology: October 3's 12-component wiring run progressed from score 69 with four errors to 100 with none on pass two. An October 4 run progressed 0 → 70 → 90 with legacy error counts 10 → 2 → 0.
- Newer records contain input snapshots and per-pass duration, finish reason, validation issues, and requirement results. These make future exact replays possible where older requests could only be reconstructed.
- Two 12V-requirement/48V-system conflicts were rejected in 0–4 ms. This is useful preflight behavior; separately investigate whether stale UI requirements caused those conflicts before labeling them user mistakes.
- The documented interruption work adds premature-stream errors, prompt retention, late-event guards, and recovery controls. Its automated verification used mocked providers; it is not evidence that provider-backed failure paths are fully verified.

## Failures and avoidable work

1. **Scores hide unresolved and failed checks.** An October 4 request scored 100 on all three passes but retained an unfused-battery error. Today's score-100 results remain incomplete. Current `runStatus` helps, but legacy score, completion, and verified checks must stay visibly distinct.
2. **Some problems cannot be repaired by changing wires.** Today's latest aborted request had eight fixed components, including two batteries, MultiPlus, SmartShunt, Cerbo, MPPT, Orion, and a positive bus bar; no fuse/breaker or solar panel was present. Input feedback already reported missing battery protection and solar connection. A wires-only operation cannot add that equipment. Return a concrete equipment-change proposal before an expensive provider attempt.
3. **Abort causes are ambiguous.** Three failed requests report only “Request was aborted.” after 82.9–90.1 seconds. The source combines a per-call timeout with an overall/cancellation signal. The records do not distinguish user cancellation, disconnect, provider deadline, or total budget exhaustion; do not assume all three were provider outages. The October 2 partial-design completion also contains an aborted pass.
4. **Unresolved calculations trigger wasted correction passes.** One October 2 run scored 100 with zero legacy errors from pass one but continued for six passes, taking 178.1 seconds. Another scored 97 throughout six passes, taking 117.0 seconds. AI Wire's stop condition includes a separate critical calculation issue list, so validator score alone does not explain whether another pass is useful. Record each continuation reason explicitly.
5. **Later candidates regress.** October 4's 158.3-second run reached score 90/no legacy errors on pass three, then produced 70/two errors on all three remaining passes. The best candidate was retained, which is useful, but the remaining work did not improve its reported outcome. Structural repetition detection is too narrow to catch every semantic plateau.
6. **Electrical coverage is still limited.** Source inspection identifies unsupported Lynx behavior, ambiguous multiple-source/cyclic/parallel paths, and undeclared inverter AC demand as possible unresolved causes. Today's input snapshots include Lynx and inverters without declared AC loads. Exact final review issues should be persisted to distinguish missing inputs from unsupported analysis reliably.
7. **Requirements are only partially structured.** Several logged wire runs mark requirements complete after only one check (DC voltage), with no equipment or connection requirements. Earlier ones retain a blank prose constraint and need review. “Complete” must communicate its checked scope. Aggregate battery capacity, solar capacity, topology, and parallel conductor count need explicit checks.
8. **Iteration reporting can be inaccurate.** The October 2 partial-result record stores six iterations but its history contains three attempts. The SSE final-result branch uses `maxIterations` for logged iterations and `finalIteration`. Log actual attempts and persist the actual stop reason instead.

## Proposed delivery order

### 1. Make outcomes measurable and stop impossible runs

- Separate request outcome, candidate availability, electrical status, and requirement status in the admin view and proposal UI. Display error/unresolved counts ahead of the numerical score.
- Persist final shared review issues, actual attempts, stop reason, continuation reasons, abort source, validator/analysis versions, provider settings, and attempted/served model. Keep existing snapshots; avoid duplicating personal data in aggregate reports.
- Before AI Wire, classify blockers as missing equipment, missing specifications, unsupported analysis, or repairable wiring. Present add-equipment suggestions for missing fuses/panels and requested input fields for missing ratings. Preserve existing equipment and require an explicit reviewed operation to add/remove it.
- Normalize empty constraints. Distinguish “all declared checks passed” from “the entire requested design is covered.”

Acceptance: replay the missing-fuse/panel case without a provider call; voltage conflicts retain useful field-level messages; a three-attempt partial run reports three attempts; abort fixtures produce distinct causes; score 100 never hides electrical failure/incompleteness.

### 2. Bound corrections by what they can improve

- Classify issues before constructing feedback. Unsupported analysis and missing user values return a review-needed proposal rather than repeatedly asking the model to guess.
- Rank candidates by requirement preservation and electrical failures before legacy score/layout. Do not use wire count as a general quality tie-breaker.
- Compare normalized topology and stable issue IDs, ignoring incidental IDs/order, to detect semantic repetition. Keep an escape for genuinely changed candidates with measurable progress.
- Repair only the affected connections; preview the diff and preserve unaffected equipment, wires, terminal IDs, and properties. Maintain atomic apply/undo and stale-input checks.
- Derive terminal compatibility and known wire sizing deterministically from declared inputs. Do not silently invent physical lengths or unsupported currents.

Acceptance: replay the 0 → 70 → 90 → 70 case; stop when remaining blockers cannot be improved by the operation, retain the best eligible proposal, and preserve all requested/fixed equipment. Test equal-score candidates with different electrical error counts.

### 3. Expand analysis and requirements using real cases

- Prioritize battery-bank/shared paths, Lynx distribution, inverter input demand, and PV/MPPT wiring because they occur in the inspected requests. Check current PV coverage before adding duplicate implementation.
- Add structured aggregate solar/battery capacity, required paths, fixed equipment, and conductor multiplicity to requirements. Detect conflicts between requested topology and supported rules before generation.
- Store unresolved reasons on the proposal and show the specific missing rating/input where supported. Validate fixture expectations independently before broadening claims of verified analysis.

Acceptance: reviewed fixtures for the eight-component interrupted case, today's three fast wiring cases, a two-bank RV, and shore-power/AC circuits. Every requested circuit remains present; unsupported scenarios stay explicit.

### 4. Run a controlled task-specific model evaluation

- Use a fixed regression set spanning simple DC wiring, inverter/AC loads, solar, complex RV/marine, multiple banks, missing equipment, and unsupported circuits. Repeated runs must use identical requirements, validator version, output limits, and retry budgets.
- Measure requirement-complete and no-electrical-error rates, unresolved rates, first acceptable candidate latency, p50/p95 latency, attempts, and cost per acceptable candidate. Include timeouts and parser failures in denominators; keep unknown cost unknown.
- Compare reasoning settings separately from feedback/prompt changes. Preserve enough output capacity to avoid repeating the documented truncated-JSON issue.
- Use availability failover separately from design repair. Reject fallback candidates that fail supported electrical/requirement checks; do not accept a high legacy score as the gate.
- Set rollout thresholds after a repeatable baseline, then use a limited rollout and rollback criteria. Do not switch the default model based on today's small/simple sample.

The prior 25-call latency experiment found promising simple-solar low-reasoning behavior but complex-case regressions. The free-model benchmark found 3/4 clean Nemotron wiring results versus 2/10 clean design results. These historical results justify task-specific testing, not a general model-switch recommendation or a claim about current provider availability/pricing.

## First implementation increment

Deliver accurate outcome/abort/attempt reporting and AI Wire preflight together, with a replay fixture for today's eight-component request. This makes failures actionable and avoids paid attempts that cannot solve missing equipment. Follow with issue-aware stopping and candidate ranking; then expand electrical/requirement coverage and measure model options.

## Supporting records

- [Latency investigation and 25 provider trials](benchmarks/ai-latency-2026-10-02/report.md)
- [Free fallback benchmark](benchmarks/openrouter-free-2026-10-01/report.md)
- [Initial requirements and shared-analysis delivery](testing/seven-workstreams-2026-10-02.md)
- [Interruption and recovery verification](testing/ai-recovery-and-device-models-2026-10-02.md)
- [Broader product roadmap](product-improvement-roadmap.md)

Production request references for replay: latest abort `9e76e8ad-a001-449f-bdad-e14a1d920619`; 100-score electrical failure `15bb2534-ad5a-4619-9220-bf1155bd143a`; regression after pass three `ac2d174f-f04c-4df8-83a9-b1bb0050a90a`; repeated 100-score run `3c31d3d0-7fd8-49d3-86a8-2240cbbf152f`; inaccurate partial-run attempt count `542147dc-201d-4c78-8e78-f59e1da60bdd`.

## Implementation follow-through

The review above is the original read-only baseline. The user subsequently authorized implementation. All four implementation workstreams are now delivered and deployed; [implementation, tests, and remaining limits](testing/ai-improvements-2026-10-05.md) and [the controlled provider comparison](benchmarks/ai-reliability-2026-10-05/report.md) record the result. Production model settings were retained because the controlled comparison did not improve electrical approval.
