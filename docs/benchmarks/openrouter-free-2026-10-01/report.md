# OpenRouter free fallback shootout

Test date: 2026-10-01 UTC. Status: complete. 16 models screened; 68 case executions recorded.

## Findings

Recommendation: `nvidia/nemotron-3-super-120b-a12b:free` is the strongest candidate for a **validation-gated AI Wire fallback**, with reasoning disabled. It returned three error-free passing wiring results out of four repeated tasks, averaging 89/100 with median latency 8.1 seconds. The sample is small and one AC wiring result failed with five errors, so every output needs the app's normal validation before it can be accepted.

A general automatic system-design fallback is **not supported by these results**. Nemotron passed only 2/10 repeated design tasks, both simple branch-fusing examples; Apodex passed 0/10. Apodex was faster at wiring but only 1/4 repeated wiring outputs were error-free. Every default-reasoning system-design screening either timed out at 90 seconds or failed before a design could be scored.

The 2,048-token reasoning trial did not rescue full system generation within two passes: Nemotron improved from 0 to 44/100 in 111 seconds and still had two overlap errors; Apodex timed out. In that trial Apodex's DC wiring reached 100/100, but Nemotron's DC wiring reached only 57/100 with four errors. This additional profile remains unproven.

Qwen and both Gemma variants returned HTTP 429 during screening. Inkling returned HTTP 403 restricting it to approved agentic harnesses. Several other models timed out, returned incompatible responses, or failed JSON parsing. Poolside S and the zero-priced Space Bunny preview each produced one clean wiring output, but took 89 and 57 seconds respectively and timed out on system generation.

This shootout evaluates model choices and settings; it does not configure production failover. A future integration should trigger on provider availability failures, preserve the original failure alert, clearly identify the fallback model used, enforce a timeout, and reject wiring outputs with validator errors or unmet component requirements.

## Default-settings screening

| Model | Responses | Benchmark passes | No-error passes | Mean score | Median seconds | Failure / limitation |
|---|---:|---:|---:|---:|---:|---|
| `apodex/apodex-1.1-mini:free` | 1/2 | 1/2 | 1/2 | 100 | 51.7 | This operation was aborted |
| `poolside/laguna-s-2.1:free` | 1/2 | 1/2 | 1/2 | 97 | 89.5 | This operation was aborted |
| `stealth/space-bunny-alpha` | 1/2 | 1/2 | 1/2 | 94 | 73.7 | This operation was aborted |
| `liquid/lfm-2.5-2.6b:free` | 1/2 | 0/2 | 0/2 | 66 | 29.2 | No JSON object found in model response |
| `dots-studio/dots-3-note-preview:free` | 1/2 | 0/2 | 0/2 | 51 | 80.5 | This operation was aborted |
| `cohere/north-mini-code:free` | 0/2 | 0/2 | 0/2 | — | 90.0 | This operation was aborted |
| `google/gemma-4-26b-a4b-it:free` | 0/2 | 0/2 | 0/2 | — | 1.8 | 429 Provider returned error |
| `google/gemma-4-31b-it:free` | 0/2 | 0/2 | 0/2 | — | 1.7 | 429 Provider returned error |
| `inclusionai/ling-3.0-flash-sante:free` | 0/2 | 0/2 | 0/2 | — | 0.1 | 400 Provider returned error |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 0/2 | 0/2 | 0/2 | — | 0.2 | No JSON object found in model response |
| `nvidia/nemotron-3-super-120b-a12b:free` | 0/2 | 0/2 | 0/2 | — | 90.0 | This operation was aborted |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 0/2 | 0/2 | 0/2 | — | 45.2 | No JSON object found in model response; This operation was aborted |
| `nvidia/nemotron-3.5-lightning:free` | 0/2 | 0/2 | 0/2 | — | 90.0 | This operation was aborted |
| `poolside/laguna-xs-2.1:free` | 0/2 | 0/2 | 0/2 | — | 12.5 | No JSON object found in model response |
| `qwen/qwen3.8-27b:free` | 0/2 | 0/2 | 0/2 | — | 2.6 | 429 Provider returned error |
| `thinkingmachines/inkling:free` | 0/2 | 0/2 | 0/2 | — | 0.0 | 403 thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps |

## Repeat tests with reasoning disabled

| Model | Task | Responses | Benchmark passes | No-error passes | Mean score | Median seconds |
|---|---|---:|---:|---:|---:|---:|
| `nvidia/nemotron-3-super-120b-a12b:free` | wiring | 4/4 | 3/4 | 3/4 | 89 | 8.1 |
| `apodex/apodex-1.1-mini:free` | wiring | 4/4 | 3/4 | 1/4 | 83.5 | 4.4 |
| `nvidia/nemotron-3-super-120b-a12b:free` | core-designs | 9/10 | 2/10 | 2/10 | 21.2 | 44.2 |
| `apodex/apodex-1.1-mini:free` | core-designs | 10/10 | 0/10 | 0/10 | 13.2 | 17.5 |

## Bounded reasoning trial (up to two iterations)

| Model | Task | Benchmark passes | No-error passes | Score | Seconds |
|---|---|---:|---:|---:|---:|
| `apodex/apodex-1.1-mini:free` | wiring | 1/1 | 1/1 | 100 | 49.5 |
| `nvidia/nemotron-3-super-120b-a12b:free` | wiring | 0/1 | 0/1 | 57 | 78.9 |
| `nvidia/nemotron-3-super-120b-a12b:free` | core-designs | 0/1 | 0/1 | 44 | 111.0 |
| `apodex/apodex-1.1-mini:free` | core-designs | 0/1 | 0/1 | — | 90.0 |

## Method

- Live OpenRouter catalog: fifteen explicit `:free` chat variants and one currently zero-priced preview, `stealth/space-bunny-alpha`. All selected models had zero input and output token prices when tested. The preview has no guarantee of remaining free or keeping the same model ID.
- Every model was screened on the same 12V camper van design and fixed-component DC wiring task, using the app’s versioned prompts, terminal repair, wire sizing, and validator.
- Two models were additionally screened with `reasoning: {enabled: false}` requested, then tested across five design cases and two wiring cases, each repeated twice. Results for that profile are shown separately; disabling reasoning is a request, and providers may apply it differently.
- Design cases cover a camper van, a 240V cabin, Lynx distribution, small branch fuses, and alternator/DC-DC charging. Wiring cases cover DC components and the inverter/panel/AC-load path.
- Each case uses one generation, a 90-second request deadline, and a 32,000 token limit (LFM uses its advertised 8,192 maximum). SDK retries are included in the elapsed time.
- A benchmark pass requires a score of at least 70 for system designs or 60 for wiring, plus every case expectation. A no-error pass additionally has zero validator errors. The existing benchmark permits some designs with errors to pass, so both measures are reported.
- Mean scores include returned designs only; timeout/API/parser failures remain in the total-test denominator. Median latency includes failures. A blank score means there was no design to evaluate.
- Default and reasoning-disabled cases are single-pass. The bounded reasoning trial requests a 2,048-token reasoning budget and allows two passes with validator feedback. The shootout does not establish how well a model converges with six refinement attempts. No paid model judging or paid candidate calls were used.
- This is a short availability sample and validator comparison, not a long-term uptime measurement or independent visual review.

## Reproducibility

System-design prompt hash: `560ad1a680845c6e`.
Wiring prompt hash: `d6e006baf13f8b84`.

Source hashes are recorded in `summary.json`; the workspace contained existing uncommitted changes. Every benchmark run, case result, output, and issue was saved to the app’s benchmark database and its matching JSON file here.

## Files

- [Per-case results](results.csv): every score, expectation, error count, latency, and database run ID.
- [Summary](summary.json): aggregates and source fingerprints.
- `catalog.json`: the live model metadata and pricing snapshot.
- `manifest.json`, `extra-manifest.json`, `tuned-manifest.json`: settings and run IDs.
- `requests.json`, `extra-requests.json`, and requests in `tuned-manifest.json`: served model, provider, finish reason, latency, and reported cost where present.
- `<run-id>.json`: complete outputs and validator issues for each run.

Free quotas and endpoint availability can change: [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits).

## Follow-up: free-model collection coverage

Compared with [OpenRouter’s free-model collection](https://openrouter.ai/collections/free-models), the original shootout covered 13 of its 14 chat models. Inkling Small was the missing chat model. Two additional generation/wiring attempts now both returned HTTP 403, stating that this model is available only through approved agentic harnesses. All 14 chat entries have therefore been attempted, though access restrictions prevented quality testing of Inkling and Inkling Small.

The two Voyage entries are rerankers rather than chat models, and the page lists nonzero token pricing for them. They were excluded from the design fallback tests. The original shootout remains a 16-model, 68-case cohort; including this follow-up gives 17 models and 70 case executions. [Coverage audit](collection-check.json). The recommendation is unchanged.
