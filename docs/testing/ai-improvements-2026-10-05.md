# AI improvements implementation and verification

Implemented the four workstreams from [the review plan](../ai-review-and-improvement-plan-2026-10-05.md):

- Structured no-call preflight for missing protection, solar equipment, declared requirements, and missing ratings; actionable property/equipment suggestions with original canvas preserved.
- Shared issue-aware correction policy, candidate ranking by requirements/electrical failures, semantic plateau detection, bounded attempts and time, and preservation of unaffected equipment/wires including parallel conductors. Unsupported analysis and unknown specifications do not trigger guessed repairs.
- Separate completion, candidate availability, electrical errors/unresolved checks, declared requirement scope, legacy score, and stop reasons in proposals/admin. Shared final reviews, actual attempts, provider settings/served models/finish reasons, and run-budget/provider-timeout/disconnect attribution are recorded. A disconnected HTTP client cannot be reliably distinguished from a user clicking cancel, so it is labeled client-disconnected.
- Conservative analysis for Lynx DC distribution, explicitly declared parallel battery banks on common downstream paths, declared inverter DC sizing demand, Orion input/output specifications, and Quattro AC terminals. Individual battery sharing, ambiguous multiple sources, and unsupported split-phase remain unresolved. Existing PV analysis is reused.
- Aggregate solar watts/battery capacity, fixed equipment/properties, ordered protected paths, terminal-specific required connections and conductor multiplicity. Optional prompt controls expose capacities/connections; Properties exposes reviewed inputs. New AI conductor lengths are marked estimated until a user provides a physical length.
- Strict electrical/requirement gates on availability fallback and versioned reproducible regression evaluation with task metrics, unknown-cost handling, configurable reasoning settings, and provider deadlines. Production model default stays unchanged.

## Automated verification

TypeScript passed. Full suite: 608 tests passed, five opt-in integration tests skipped (53 files passed, one skipped). Additional final targeted checks cover newly added preflight, optional requirement controls, abort attribution, candidate preservation/ranking, semantic stopping, provider failures, and benchmark contracts. Targeted results and deployment/browser evidence are appended below.

## Controlled provider evaluation

[Report and archived results](../benchmarks/ai-reliability-2026-10-05/report.md): 32 executions, 28 provider calls, two reasoning profiles. Each profile yielded 2/16 acceptable results; missing-equipment cases never called the provider. Low reasoning was faster without a quality improvement. Keep existing default; rollout/rollback criteria are documented in the report.

## Scope of evidence

Regression fixtures are automated conservative checks and have not received independent electrical-engineer approval. Authenticated proposal/admin interactions are covered by functional and API tests; the collaborative production browser is signed out. Browser checks retain the existing local diagram and do not bypass authentication. No database migration is required; added observability/evaluation fields use existing JSON columns.

## Final release verification

- Final TypeScript check and `git diff --check` passed.
- Final targeted API/policy/fallback/benchmark/UI suite: 84 tests passed in six files. An additional 23 electrical/Properties tests passed after correcting the remaining legacy inverter utilization display.
- `npm run build` completed, then `sudo systemctl restart victron-designer.service` applied the final code. Service active; homepage HTTP 200 after startup. Read-only production observability query successfully returned electrical-status aggregates for all three AI action categories.
- Collaborative production browser reloaded the deployed build, selected the existing battery and inverter, and opened Review. Battery bank input and inverter reviewed DC sizing input are visible. The inverter with no AC loads now shows the missing-input explanation and no fabricated AC load/DC input current. Review displays electrical errors separately from unresolved counts and the analysis version. Existing diagram equipment/properties were not edited; the Properties panel was returned to its initial closed state.
- Screenshots: [battery reviewed inputs](ai-improvements-2026-10-05/battery-reviewed-inputs.png), [inverter missing-demand explanation](ai-improvements-2026-10-05/inverter-reviewed-demand.png). Native preview recording was started, but the recording-stop tool failed on the client twice, so no video artifact is claimed.
- Build retained existing nonfatal warnings about old Browserslist data, PostCSS metadata, and bundle size. Authentication remained enforced; no authenticated production AI request was submitted through the signed-out browser.

## Follow-up: direct application with Undo/Redo

The user requested removal of all AI Apply/Cancel prompts. Completed AI design and wiring results now apply as one document update, including incomplete review results; detailed checks remain in the canvas Review panel. Missing-input preflight returns a short message without editing the canvas. Invalid document data still leaves the existing design intact. Clear Canvas now acts directly with Undo available. Icon-only cleanup continues to preserve all equipment and wires without a provider call.

Verification: TypeScript and whitespace checks passed; 12 functional/document-history tests passed, covering direct generation, AI wiring with unresolved checks, Undo/Redo, Clear Canvas recovery, preflight without a popup, and icon-only cleanup. Built and restarted the production service after the UI changes.
