# Controlled AI reliability evaluation — October 5, 2026

32 case executions: eight fixed cases, two repeats, two Gemini 3.8 Flash native-provider profiles. Single pass, 32,000 output-token cap, 90-second request deadline, identical declared requirements and engine 1.3.0/policy 2026-10-05.1. Four preflight-blocked executions made no provider call; 28 model calls completed. No vision judges or user designs were used. Raw candidates, shared review, settings, input hashes, finish reasons, usage, and per-pass timing are archived in `default.json` and `low.json`.

| Metric | Default | Low reasoning |
| --- | ---: | ---: |
| Acceptable results | 12.5% | 12.5% |
| No electrical errors | 50% | 43.75% |
| Declared requirements complete | 87.5% | 87.5% |
| Unresolved results | 75% | 75% |
| Median latency, all executions | 5737 ms | 2098 ms |
| p95 latency, all executions | 27991 ms | 4110 ms |
| Returned candidates | 14 | 14 |

Both profiles passed the two simple-DC repetitions only (2/16 acceptable). The zero-error metric is distinct from electrical approval: unresolved calculations still prevent approval. Aggregate cost and cost per acceptable result remain unknown because current model pricing is unavailable to the local pricing table. Output usage includes reasoning tokens when returned by the provider.

| Case | Default approved / 2 | Low approved / 2 | Default p95 ms | Low p95 ms |
| --- | ---: | ---: | ---: | ---: |
| simple-dc | 2 | 2 | 6167 | 1714 |
| lynx-distribution | 0 | 0 | 5921 | 4110 |
| inverter-ac | 0 | 0 | 10748 | 2361 |
| solar-mppt | 0 | 0 | 13260 | 2457 |
| parallel-bank | 0 | 0 | 27991 | 2717 |
| shore-ac | 0 | 0 | 4091 | 2230 |
| missing-equipment-eight | 0 | 0 | 1 | 1 |
| unsupported-sharing | 0 | 0 | 4757 | 1468 |

## Decision and limits

Keep production model defaults unchanged. Low reasoning reduces latency in this sample, but does not improve acceptable-result rate and has a lower zero-error rate. Estimated new conductor lengths, unspecified source sharing, and remaining topology errors make complex proposals require review. These are synthetic regression fixtures with conservative checks, not independently approved installation designs or an exact replay of every historical request. The comparison does not measure the effect of the policy change against the previous production policy.

## Rollout and rollback gate

Before changing a default, collect at least ten paired repetitions per supported task class, with reviewed physical lengths/specifications and independent electrical fixture review. Require no lost fixed equipment/circuits, no unsafe accepted fallback, no reduction in requirement completion or electrical approval, and at least 20% lower p95 time to an acceptable candidate. Missing-equipment cases must make zero provider calls. Start with a limited opt-in cohort; revert the model setting immediately on an unsafe accepted result or lost declared circuit, and revert on a greater than 10 percentage-point decline in approval/completion or a greater than 20% increase in p95 against the paired baseline. Unsupported cases remain review-needed and cannot be made acceptable by a score threshold.
