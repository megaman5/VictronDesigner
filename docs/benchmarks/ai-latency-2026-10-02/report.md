# AI latency investigation — 2026-10-02

## Findings from the requests in the screenshot

All ten requests record Gemini 3.8 Flash as both the primary and served model, with `response._debug.aiRouting.usedFallback: false`. Eight record six iterations. The two blank quality cells were zero, hidden by a falsy-value UI check. Both zero-score wiring requests had six consecutive zero-score passes. The 31-component request went 73 → 79 → 44 → 44 → 44 → 28; later passes did not improve its best result.

Separate, earlier fallback events on October 1 at 18:33 and 18:39 UTC record HTTP 402 billing failures and switching to Nemotron. They are not the ten requests shown in the screenshot.

**Confirmed code bug:** AI Wire constructed correction feedback but never included it in the API messages. Every iteration sent the original components and original wires, not the best candidate and its errors. This explains wasted correction attempts; it does not prove every poor result has the same cause.

`success: true` currently means the request completed, not that the returned design is free of validation errors.

## Experiment

25 direct provider calls, four models, three cases. No automatic fallback, no SDK retries, 90-second timeout per call, at most three concurrent calls. No saved user designs were modified. Production model selection was unchanged.

- **Solar:** original saved prompt and system message for a 3kW RV solar system with 400Ah batteries.
- **Complex RV:** original saved prompt and system message with two battery banks, Lynx, a MultiPlus, two AC sources and a transfer switch.
- **Wiring:** reconstructed 18-component case using matching component IDs from the user's later saved design and the logged returned wires. Original wire-request input snapshots were not logged. This is a repair experiment, not an exact historical replay.

The initial screen used 16,000 completion tokens. Original prompts were compared with a suffix requesting compact JSON, omitting prose, preserving requested equipment/circuits and placing battery fuses before switches. GPT-5.4 and GPT-5.4 Mini used low reasoning; Nemotron used reasoning disabled and a zero-price provider restriction. Gemini initially used default reasoning. Two concise Gemini design cases were repeated.

A diagnostic repeat confirmed `finish_reason: length`: Gemini used almost all a 16,000-token allowance on reasoning and produced only 636 visible completion tokens, ending in incomplete JSON. Thus the initial parse failures cannot fairly be treated as intrinsic model-quality failures. The final six calls compared Gemini default and low reasoning with 32,000 tokens. The low-reasoning wiring call also included current validation feedback (two variables changed there).

Scores below are from the existing deterministic validator after the existing normalizer, pinned to repository baseline da3ff95. The unrelated dirty validator in the main checkout was excluded. Where available, `rawScore` and `rawErrors` in results.json show validation before normalization. Provider timeouts include no fabricated score. A high score is not a requirement-compliance pass.

## Selected comparisons

| Method | Solar: seconds / score / errors | Complex RV: seconds / score / errors | Wiring: seconds / score / errors |
|---|---|---|---|
| Gemini default, 32k | 74.8 / 38 / 5 | 48.8 / 40 / 6 | 23.3 / 0 / 17 |
| Gemini low reasoning, 32k | 14.3 / 100 / 0 | 15.5 / 14 / 2 | 5.6 / 0 / 9* |
| GPT-5.4 Mini, concise, 16k | 26.5 / 23 / 5 | 23.5 / 62 / 2 | 11.6 / 0 / 17 |
| GPT-5.4, concise, 16k | timeout at 90s | timeout at 90s | 43.1 / 0 / 16 |
| Nemotron, concise, 16k | 48.8 / 2 / 4 | 70.5 / 0 / 6 | 22.4 / 0 / 11 |

*Wiring low-reasoning call also added feedback. It disconnected three batteries, so fewer validator errors did not represent an acceptable repair.

Gemini concise at 16k produced solar score 100 in 18.9s and RV score 39 in 32.7s. Repeats produced truncated solar JSON and RV score 91 in 20.7s. This variance argues against changing defaults based on one run. All 25 results, including failures, are in results.json. Reported usage is retained where captured; failed/aborted calls may still incur cost, so these records do not establish an exact total bill.

## Requirement and browser checks

The low-reasoning solar result actually contains 3,000W of panels and 400Ah of batteries. Loaded it in the collaborative browser: rendered successfully and the UI showed quality 100.

The concise RV repeat renders and scores 91, but contains only one 2/0 inverter conductor per polarity, omitting the explicitly requested parallel pair. The original brief also conflicts with app rules: it requests disconnect-before-fuse battery paths and parallel 2/0 inverter conductors, while the validator requires direct battery protection and 4/0 for parallel runs. Repeatedly regenerating the whole system cannot resolve that requirements conflict reliably.

Loaded both results locally for inspection; restored the original four-component browser design and verified identical component/wire arrays. The browser was signed out, so authenticated admin-table verification was unavailable. No account permissions were bypassed.

## Shipped changes

1. Send the best wiring plus deduplicated validator errors, suggestions and wire-calculation feedback on correction passes.
2. Stop after two consecutive identical correction attempts (candidate and validation issues), keeping the best result and explaining the stop in the response/visible toast description. Equal scores alone do not trigger this stop.
3. Render quality score zero as `0`, not `-`, in the admin table and detail view.

Validation: 63 targeted tests passed (provider failures, benchmark runner, provider adapters and model routing); the final description adjustment was followed by all 17 endpoint integration tests passing again. Production build passed and the service was rebuilt/restarted from the isolated worktree. No default model, reasoning setting, fallback policy or validator rules were changed.

## Recommended next changes

- Keep Gemini as default for now. Low reasoning is a promising candidate for simple generation, but the complex-case regression prevents a blanket switch.
- Separate requirement checking from generation: flag incompatible requested topology/gauges or missing fixed-canvas protection before spending six passes. Do not let the model silently omit requested circuits to earn a higher score.
- Use AI for topology, then deterministic terminal matching/current sizing, followed by targeted corrections. Validate current inference for custom components and multi-bank systems before trusting scores or asking another model to fit them.
- Evaluate task-specific low reasoning on more fixed regression cases, with both no-error validation and explicit requirement checks. Keep a sufficient output allowance; cutting token caps blindly can truncate JSON after reasoning consumes the budget.
- Record first-request component snapshots, per-pass duration, finish reason and reasoning usage so future replays are exact and timeout/token problems are distinguishable from topology failures. Make completion status and design-quality status distinct in the admin display.

Google documents the compatibility endpoint's reasoning-effort controls and default behavior: https://ai.google.dev/gemini-api/docs/openai#thinking . OpenAI's latency guide recommends reducing output and unnecessary sequential model calls: https://developers.openai.com/api/docs/guides/latency-optimization . Those are hypotheses to test against this application's correctness requirements, not evidence that a faster model is automatically better.
