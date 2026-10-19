# AI reliability review — October 9, 2026

## Changes shipped

- Restore saved physical wire lengths **after terminal matching and before gauge calculation**, across all four AI endpoints and the benchmark runner. Preserve intentional length changes and mark them estimated. Parallel wires still match once each.
- Bound streaming inactivity at 90 seconds, non-streaming completions at 120 seconds, and the entire production AI run at four minutes. Fallback and repair passes share the overall budget. Keep the earlier best draft when a later request reaches the deadline; return HTTP 504 if no candidate arrived. Cancel and clean up timers on response completion/disconnection.
- Validate the provider's JSON structure before normalization. A malformed later repair preserves the earlier candidate instead of losing the whole request. Streaming validation failures before headers now return the proper HTTP error.
- Show AI Wire's equipment/specification prerequisites locally, with all blockers and links to affected equipment. No model or server request is needed for these local blockers.
- Distinguish a completed draft from failed or incomplete electrical/requirement checks in completion notices. The existing request-completion log field remains separate from the recorded electrical status.
- Fix dropdown crashes after translation replaces a React-owned text node. Keep a stable element boundary in the Radix item label that is portaled into the selected value.
- Replace client `Array.at` history/layout calls for older browsers.
- Use Express's encoded download headers for Unicode report/CSV filenames, including control-character handling.
- Recover Google OAuth callback errors with a retry page and a visible notice; keep return redirects local.

## Experiments

All live AI experiments used synthetic fixtures and left the admin-selected model unchanged.

| Experiment | Result | Decision |
| --- | --- | --- |
| Native adapter, default reasoning, simple DC / inverter AC / solar MPPT | 3/3 electrically passed, requirements complete; 9.6 / 26.0 / 13.7 seconds; $0.0346 generation total | Baseline |
| Native adapter, low reasoning, same three fixtures | 3/3 passed; 3.7 / 4.7 / 4.7 seconds; $0.0162 total | Promising, requires production-path verification |
| Production-compatible path, default reasoning, inverter AC / solar MPPT / Lynx distribution | 3/3 passed; 25.1 / 13.2 / 11.8 seconds | Retain current settings |
| Production-compatible path, low reasoning, same three fixtures | 2/3 passed; 6.4 / 4.3 / 3.9 seconds; inverter case had one electrical error despite score 100 | **Rejected as a production default** |
| Complex full generation: Lynx catamaran / alternator with multiple banks | Lynx exceeded the benchmark's 90-second deadline; alternator returned score 0 with four electrical errors and 31 unresolved checks | Remains unreliable; retain explicit draft/check statuses |

Native benchmark run IDs: `e2e65106-aa95-4f2a-95c3-16c41f880912` (default), `182ba2a4-af16-4156-95f0-b5b27a8cf2fa` (low), `8ebef690-1389-4a5d-9667-d5b516c0c22c` (complex).

[Production-path experiment results](ai-reliability-2026-10-09/provider-experiment.json) record timings, provider settings, usage, and checked status. [The reproducible script](../../scripts/ai-reliability-review.ts) uses the production-compatible path. Google's [compatibility documentation](https://ai.google.dev/gemini-api/docs/openai) documents the reasoning setting tested here.

These are small, single-sample comparisons, not proof of general reliability or electrical certification. Benchmark timeouts are independent of the production run budget. Private production designs were not sent to these benchmark calls.

## Verification

- TypeScript check passed.
- 189 tests passed in 20 files: all functional suites plus AI fallback, policy, normalization, output parsing/notices, requirement/provider endpoints, OAuth recovery, and document history.
- Endpoint regressions exercise saved-length sizing across all four AI routes, including SSE, and retain earlier candidates after malformed later output.
- Deadline endpoint tests verify HTTP 504 without a candidate and HTTP 200 with the earlier candidate and `stopReason: run-deadline`.
- Built with `npm run build`, restarted `victron-designer.service`, and verified the service and HTTP endpoint are healthy.
- Live browser: wrapping the selected gauge text in a translation-style `<font>` node caused the old build's `removeChild` failure at approximately 15:23:49 UTC. The same mutation and AWG → mm² interaction on the new build succeeded and kept the canvas rendered. Deliberately generated browser error records at that time belong to this test.
- Live browser: report name `Båt ☀️ 漢字` reproduced HTTP 500 before the fix; the new build returned HTTP 200, kept the name in the report, and supplied a UTF-8 `filename*` download header.
- [Browser screenshot after verification](ai-reliability-2026-10-09/browser-verified.png). The recording captured the reproduction, rebuild/reload, and successful retest, but exceeded the preview tool's 50 MiB attachment limit; the tool reported that its saved copy remains on the desktop. A shorter recording attempt could not run because the desktop preview disconnected after verification. No downloadable video was produced.
- The live browser also kept rendering while `Array.prototype.at` was temporarily unavailable and the gauge setting changed; the intrinsic and original AWG preference were restored afterward.

## Next experiments

1. Build small, validated circuit templates for alternator/DC-DC charging, shunts, and Lynx distribution. Let AI select and connect templates, then validate the assembled graph, rather than regenerate whole complex systems each pass.
2. Extend supported analysis for multi-bank, source-sharing, and manufacturer-specific devices using reviewed fixtures. Keep unsupported calculations visible until they are implemented and independently checked.
3. Test focused topology repairs against the synthetic complex cases and measure first electrically acceptable result, retained requirements, and total elapsed time. Avoid optimizing the numerical layout score alone.
4. Revisit low reasoning only for narrowly identified simple tasks after repeated production-path trials. The observed AC error prevents a broad rollout now.
