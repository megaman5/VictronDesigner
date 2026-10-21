# VictronDesigner improvement roadmap

Date: October 2, 2026

## Objective

Make the designer easier to experiment with, more dependable when generating and checking systems, and more useful when handing a design to an installer. Deliver all six improvements in small releases with measurable acceptance criteria.

This document records the original implementation plan. Initial delivery and verification status are tracked in [the seven-workstream report](testing/seven-workstreams-2026-10-02.md).

## Current starting point

The app already has terminal connections, copy/paste, automatic validation, local draft recovery, authenticated cloud save/open, custom components, runtime estimates, AI correction passes, and separate diagram, shopping-list, label, and report exports.

Repository observations that affect the work:

- `client/src/pages/SchematicDesigner.tsx` holds many independent component/wire mutations and is about 2,600 lines. The canvas is about 2,150 lines. Introduce a shared editing boundary incrementally rather than rewriting both at once.
- The client and server have separate wire calculators. Current inference also lives in the validator and export code. Sharing the gauge calculator alone will not remove all inconsistencies.
- Local recovery uses a single `autoSavedDiagramState` slot and primarily saves components, wires, voltage, and time. It does not provide a project revision history.
- `server/user-designs-storage.ts` updates designs without an expected version. Two sessions can overwrite each other's changes.
- Both `/api/schematics` and `/api/designs` exist. Establish which paths the active editor uses and a migration strategy before extending persistence.
- Automatic validation is debounced by 500 milliseconds, but responses are not tied to a document revision. An older request can replace a newer result.
- The review panel combines a numerical quality score with electrical and layout issues.
- The recent AI latency investigation found that a better score can coincide with omitted requirements. Its feedback and repeated-attempt fixes have already shipped; this roadmap builds on them.
- Tests already cover substantial calculation, AI, component, and export behavior. Extend those tests around the new contracts.

## Delivery order and dependencies

| Release | Deliverable | Depends on | Approximate engineering effort |
| --- | --- | --- | --- |
| 0 | Shared document contract, fixtures, and mutation boundary | Existing editor and storage audit | 4–6 days |
| 1 | Undo/redo and atomic editing | Release 0 | 5–8 days |
| 2 | Shared electrical analysis and calculation engine | Release 0 | 10–15 days |
| 3 | Clearer review and reliable validation updates | Release 2 | 4–6 days |
| 4 | Requirement-aware AI generation and repair | Releases 1–3 | 8–12 days |
| 5 | Cloud autosave, conflicts, and revision recovery | Releases 0–1 | 8–12 days |
| 6 | Complete PDF installation package | Releases 2–3 and stable revision identifiers from Release 5 | 6–10 days |

Planning range: roughly 45–69 engineering days, or 9–14 working weeks for one dedicated developer, before schedule contingency. These are initial estimates, not commitments. Re-estimate after Release 0, especially electrical graph behavior and PDF rendering.

Saving work can proceed after undo/redo while calculation work continues. Keep production releases small even if implementation overlaps. Ship undo/redo first for an early usability improvement, then shared analysis and review before expanding AI behavior.

## Release 0: shared foundations

### Scope

Define a versioned `DesignDocument` in `shared/` containing project metadata, system settings, components, wires, persistent component/wire identifiers, and calculation-affecting options. Explicitly decide which presentation settings belong to the project and which remain personal preferences.

Keep document schema version, cloud version, editor change sequence, and calculation engine version distinct. They answer different questions: format compatibility, save conflicts, asynchronous freshness, and reproducible calculations.

Introduce a reducer or document controller as the entry point for edits. Separate persistent design content from temporary UI state such as hovered terminals, selection boxes, and panel visibility. Retain React and the existing UI; a new state-management dependency is optional.

Add schema validation and loading adapters for existing saved designs and browser drafts. Preserve unknown legacy properties where possible. Reject structurally invalid documents with a recoverable error rather than silently deleting data.

Inventory the two save APIs and identity conventions. Prefer one persistence service for the active editor, with adapters for older records if needed. Do not delete or bulk-convert existing records until compatibility is verified.

### Deliverables and acceptance

- Existing saved designs load with component IDs, terminal IDs, properties, and wires preserved.
- Every persistent editor action passes through the document controller.
- Duplicate IDs, dangling references, and malformed values receive explicit errors.
- A fixture collection covers simple solar, AC/DC loads, multiple batteries/banks, shore power, parallel conductors, custom components, incomplete systems, and legacy designs.
- Capture existing calculator and export results as baselines; classify known mistakes separately so tests do not lock in incorrect behavior.

## Release 1: undo and redo

### User experience

Add Undo and Redo buttons to the toolbar with descriptive tooltips, such as “Undo delete 3 components.” Support Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y where appropriate. Leave typing shortcuts to focused text inputs and editable fields.

Make each meaningful user action one history entry:

- Add, delete, move, rotate, or paste a component or selection.
- Create, delete, reroute, or edit a wire.
- Edit component properties, system voltage, or calculation settings.
- Clear a canvas.
- Apply an AI-generated design or wiring result.

Deleting components and their connected wires is one transaction. A drag creates one entry at completion; intermediate movement updates the preview without filling history. Group continuous property typing into a single committed edit.

### Implementation

Use bounded immutable document snapshots initially, with structural sharing and both entry-count and approximate memory limits. A starting target is 100 user actions; tune against measured large designs before release. Patch-based history can follow if snapshots exceed the memory budget.

History is scoped to the current document. Opening another project starts a fresh editing session. Clearing canvas content remains reversible without accidentally clearing the loaded project's identity. An explicit New Design action starts a new document context.

Undo/redo updates local recovery, validation, and cloud autosave through the same document change flow. Do not store recalculated outputs or transient UI state as independent history entries. Reconcile selection when restored objects change.

### Acceptance

- Undoing deletion restores the original IDs, all affected wires, properties, and positions.
- Redo produces the same document as the original edit.
- A new edit after undo clears the redo branch.
- Dragging, multi-delete, paste, and AI application each require one undo.
- Applying an AI result can be reversed without spending another AI request.
- Opening a new project cannot undo into the previous project's content.
- History remains responsive on representative large fixtures.

## Release 2: one electrical analysis and calculation engine

### Scope

Create a pure TypeScript analysis module in `shared/` that runs in both browser and server. Move or consolidate wire tables, unit conversions, gauge selection, ampacity derating, voltage drop, AC voltage resolution, inverter/charger efficiency, battery-bank calculations, and graph-based current inference.

Use existing shared battery, AC-voltage, device, and protection modules rather than introducing competing definitions.

Return a structured `AnalysisResult` for each component and wire, with input values, units, calculated values, assumptions, source of each inferred value, and an explicit known/unknown/unsupported state. Unknown current must never become zero just because inference failed. Include analysis engine version and the input document fingerprint.

### Electrical graph work

Build a terminal-aware graph that distinguishes positive, negative, AC hot, neutral, ground, PV, and data connections. Resolve branches and pass-through devices without counting the same load twice. Use traversal guards and memoization for cycles and shared paths.

Define supported scenarios explicitly: charging, discharging, relevant simultaneous sources/loads, and declared surge conditions. Wire sizing must use the governing supported scenario; simultaneous source output must not automatically cancel load demand into a misleadingly small design current.

Distinguish manufacturer limits, expected operating current, and sizing current. Keep AC and DC voltage domains separate. Preserve user-selected gauges and physical lengths; report when they are inadequate instead of silently rewriting them.

Support custom components through declared electrical behavior. If that behavior is absent, return an unresolved calculation with an actionable explanation. Do not guess how a custom component transfers or consumes power.

Before changing electrical rules, document their assumptions and check the relevant primary manufacturer or standards references. This release's shared-engine tests prove consistency and supported behavior; they do not establish general standards certification.

### Migration

First run the new module alongside existing analysis on fixtures and sampled inputs. Classify differences into intended corrections, legacy compatibility, and regressions. Then switch consumers incrementally: properties panel, wire editing, validator, AI sizing, runtime inputs where applicable, and exports.

Split electrical analysis from layout scoring. Keep compatibility wrappers until existing callers have moved. Retire duplicate logic only after matching behavior is demonstrated.

### Acceptance

- Browser, validator, and export produce identical electrical values from the same document and options.
- Golden fixtures have independently reviewed expected values, including explicit unresolved cases.
- Tests cover reversed wire direction, nested branches, disconnected circuits, cycles, multi-bank systems, parallel conductors, charge/discharge cases, and AC pass-through devices.
- Unit conversions round only for display and do not change gauge decisions unexpectedly.
- A manual wire choice survives analysis, with an issue if it fails the applicable checks.
- Large-fixture analysis performance is measured; establish a budget before enabling additional automatic checks.

## Release 3: clearer and more reliable design review

### User experience

Lead the panel with checked electrical errors, warnings, and unresolved calculations. Use factual statuses such as “3 electrical errors,” “Checks incomplete,” or “No errors found in supported checks.” Show layout quality separately.

Give each issue a stable rule ID, category, severity, explanation, affected objects, and suggested next action. Clicking an issue selects and brings the component or wire into view. Allow filtering between electrical checks, requirements, and layout.

Provide explicit states for checking, current results, stale results, and failed checks. A failed request must not leave a previous green result looking current. Show assumptions next to affected calculations.

Introduce previewable quick fixes only for deterministic changes that are well-defined, such as a calculated gauge adjustment. Applying a fix goes through the document controller and is undoable. Topology changes should show the proposed edit before application.

### Implementation

Tag requests with an editor sequence or document fingerprint. Cancel superseded requests where possible and ignore responses for older documents. Invalidate current results immediately when relevant content changes.

Debounce relevant edits, avoid rechecking for selection or panel changes, and separate layout-only movement from electrical changes where practical. Reuse the analysis result rather than recomputing current independently for each issue.

### Acceptance

- Critical electrical issues remain visible regardless of layout score.
- Older validation responses cannot overwrite newer results.
- Errors in the network or server appear as incomplete checks, with a retry action.
- Issue clicks identify the correct object even after moving or undoing it.
- Quick fixes show their effect and can be undone in one action.
- Existing review rules remain available during the UI transition.

## Release 4: more dependable AI designs

### Requirements before generation

Convert the request into an explicit requirements record: required equipment, quantities/capacities, voltage domains, named loads, required connections, constraints, and optional preferences. Store it with the design and AI attempt.

Distinguish an explicit user requirement from an AI-inferred assumption. Let users review assumptions and edit important requirements. Ask for clarification only where ambiguity prevents a meaningful design; deterministic contradictions should produce a specific explanation before repeated paid attempts.

For AI Wire, preserve the supplied component IDs and properties by contract. Wiring may change within its allowed scope; equipment removal or replacement requires an explicit broader operation.

### Generation and targeted repair

Use AI to propose equipment relationships and topology. Resolve supported terminal connections and sizes through deterministic rules and the shared analysis engine. Preserve unique terminal roles; ambiguous or unsupported matching becomes an issue rather than an arbitrary connection.

Run two separate checks on each candidate: electrical analysis and requirement fulfillment. Report both. Do not let a higher numerical score compensate for missing required equipment or circuits.

Repair the affected subgraph where possible. Send the best candidate, precise rule failures, and unmet requirements to the model. Preserve unaffected components, IDs, and manual choices. Reject a stale AI result if the user edited its input design; offer a preview against the current design instead of overwriting it.

Keep best-candidate retention and the already-shipped repeated-attempt stop. Add a bounded total time/iteration budget, explicit stop reasons, cancellation behavior, and conservative provider timeouts. Cancellation should suppress late application and stop further iterations; it may not eliminate cost for an already-started provider request.

### Observability and evaluation

Record the initial input snapshot, requirements, input hash, model/provider/skill versions, relevant settings, per-pass duration, finish reason, usage where available, validation issues, unmet requirements, and repair scope. Apply appropriate access controls and retention to these records.

Separate request completion, usable candidate returned, electrical-check status, and requirements-check status in API/admin displays.

Benchmark fixed regression cases repeatedly because model output varies. Compare requirement-complete results, supported electrical-check outcomes, latency, and cost. Include complex and custom-component cases before changing model or reasoning defaults.

### Acceptance

- A candidate missing a required battery, load, circuit, or conductor cannot be presented as requirement-complete.
- AI Wire cannot remove or mutate fixed equipment.
- Contradictory constraints produce an explanation instead of an endless correction loop.
- Shared deterministic sizing is used wherever the component behavior is supported.
- Failed or incomplete attempts preserve the user's existing canvas.
- Applied results are one undoable transaction.
- Recorded inputs allow exact reconstruction of a request for diagnosis, subject to retention policy.
- Controlled rollout meets baseline correctness and cost/latency criteria agreed before deployment.

## Release 5: cloud autosave and revision recovery

### User experience

Show a persistent status: Saving, Saved, Saved on this device, Offline, Sign-in required, or Save failed. Make the distinction between browser recovery and account storage clear.

Keep anonymous local editing. Start cloud autosave after a signed-in user creates or opens a named account design. Preserve manual Save and Save as Copy; a manual save creates a named checkpoint without producing duplicate projects.

Add a revision list with time, source, and optional description. Preview a revision before restoring it. Restoration creates a new latest revision so the previous current state remains recoverable.

### Persistence contract

Add an integer cloud version and optimistic concurrency to updates. The client sends its expected version; update the document and increment the version atomically. A mismatch returns a conflict rather than overwriting another session.

On conflict, retain the local draft and offer to load the cloud copy, compare versions, or save the local draft as a new project. Automatic graph merging is outside the first release because conflicting terminal edits need careful resolution.

Use idempotency identifiers for creation/retry and transactional revision writes. Scope local drafts by account and project, including an anonymous draft ID, so tabs and accounts cannot share one recovery slot accidentally.

Prefer IndexedDB for larger draft documents and a small compatibility adapter for existing localStorage recovery. Retain both document metadata and settings required to reopen the project correctly. Queue the latest unsaved state during outages, retry with backoff, and verify the cloud version when reconnecting. Do not create a remote revision for every pointer movement.

Separate revision checkpoints from save frequency. Proposed starting policy: preserve explicit saves, AI applications, and restores; coalesce autosave checkpoints into five-minute windows; keep 30 days of automatic checkpoints and 100 recent automatic revisions per project. Review storage cost and user expectations before finalizing retention, and provide explicit limits for manual checkpoints too.

Generate thumbnails asynchronously or only on meaningful checkpoints so autosave does not repeatedly rasterize the canvas. Audit persistence of name, description, custom-component snapshots, requirements, labels, and calculation options.

### API and migration work

Extend the active `/api/designs` flow with versioned updates and revision list/read/restore endpoints. Validate all payloads and enforce ownership on every revision operation. Decide compatibility for `/api/schematics` after the Release 0 inventory.

Use an additive migration: backfill existing designs with an initial version and create the initial checkpoint lazily or in a bounded migration. Exercise backup restore before production rollout.

### Acceptance

- Offline edits survive reload and can sync after reconnection.
- Two tabs editing the same project cannot silently overwrite each other.
- Session expiry preserves edits and stops repeated unauthorized cloud writes.
- Retried saves do not duplicate projects or checkpoints.
- Restoring an older revision keeps the displaced current revision recoverable.
- Switching accounts does not expose or silently upload another account's draft.
- Project metadata and calculation settings survive save, reopen, and restore.
- Large projects save without blocking routine canvas interactions.

## Release 6: complete installation package

### Package contents

Provide one PDF export with selectable sections:

1. Cover sheet: project name, description, date, document version/fingerprint, voltage domains, and checked status.
2. Printable schematic with legend, component references, and wire labels.
3. Terminal schedule with component, terminal, destination, polarity, wire reference, and required connection details.
4. Wire schedule with physical length, gauge/material, governing current, voltage drop, and applicable protection references.
5. Shopping list aggregating equipment, cable, protection, and declared accessories without guessing unspecified parts.
6. Print-ready wire labels with selectable supported label formats.
7. Calculation inputs, assumptions, unresolved values, and the complete validation/requirement issue list.

Keep current CSV, image, and text exports for users who need individual files.

### Rendering and data consistency

Build one export view model from a frozen document snapshot and its shared analysis result. Generate all sections from that snapshot even if the user edits during export. Persist stable component references and wire labels; new wires receive new labels without renumbering every existing wire. Handle duplicate user-defined labels explicitly.

Render the schematic independently of viewport, zoom, selection, theme, and visible canvas bounds. Include wire route extents when calculating bounds. Prefer vector geometry/text for schematic PDF content so zoom and printing remain clear; raster assets can be embedded where needed.

Offer A4/Letter and landscape/portrait with readable fit-to-page and tiled output for large diagrams. Embed fonts, repeat table headers, wrap long names, and provide page references across tiles. Make missing units and unresolved fields visible rather than exporting invented values.

Select and prototype a PDF library against representative fixtures before committing. Avoid introducing a browser-rendering service unless direct PDF rendering cannot meet requirements. Verify license, deployment support, memory use, and font handling during implementation.

Validate the frozen snapshot before exporting. If critical errors remain, show them and offer a clearly marked draft package; do not imply installation readiness. Preserve the app's planning limitations in concise product language.

### Acceptance

- Every wire label maps to the same connection in diagram, schedule, and label sheets.
- The PDF and existing exports agree with the shared analysis for the same snapshot.
- Export includes the whole diagram at different browser zoom levels and viewport sizes.
- Large diagrams, parallel wires, custom components, long labels, and both voltage domains remain legible.
- A4 and Letter sample prints have no clipped lines, overlapping table text, or missing symbols.
- Exported unresolved calculations and known errors remain visible.
- PDF generation is bounded, returns useful errors, and does not modify the document.

## Verification strategy

Use existing Vitest unit, functional, and integration suites as the base. Add tests for meaningful user outcomes and contracts rather than mirroring implementation details.

| Area | Required verification |
| --- | --- |
| Editing | Transaction grouping, undo/redo identity preservation, typing shortcuts, document switching |
| Calculations | Reviewed golden values, direction independence, unknown inputs, graph cycles, source/load scenarios, client/server/export parity |
| Review | Out-of-order responses, stale results, failed requests, issue navigation, undoable fixes |
| AI | Requirement omissions, immutable equipment, bounded repair, stale inputs, provider failure, benchmark repetitions |
| Saving | Ownership, conflicts, idempotency, reconnect, expired sessions, revision restore, migration compatibility |
| Exports | Snapshot consistency, stable labels, pagination, unit formatting, full diagram bounds, visual/print inspection |

For implementation releases, run the appropriate targeted suites, TypeScript checks, and required regression checks. Use the repository's `testing-victron-designer` skill for UI/export end-to-end verification and the collaborative browser where available. This planning document does not invoke browser testing.

Before releasing the shared electrical engine, require a review of fixture expectations and supported assumptions by someone qualified to assess those calculations. Define automated checks separately from professional design approval.

## Rollout and operational requirements

- Deliver each release behind independently controllable feature flags where old and new behavior can safely coexist.
- Keep a known-good build and additive database migrations compatible with rollback. Verify rollback does not discard new revisions or draft data.
- Follow the repository's mandatory workflow after every implementation change: `npm run build`, then `sudo systemctl restart victron-designer.service`. Check service health and smoke-test the affected flow after restart.
- Use a separate development/test service for sustained implementation; deploy reviewed increments to the live service.
- Preserve existing local changes, including the currently modified validator, when starting implementation. Reconcile its final behavior before establishing regression baselines.
- Monitor save failure/conflict rates, validation errors, AI requirement-complete rate, AI latency/cost, export failures, and history performance. Aggregate metrics without copying unnecessary design content into analytics.

## Decisions to settle during implementation

Resolve these through prototypes and measurements unless user preference materially affects the result:

- Exact history memory cap and supported maximum project size.
- Which saved project settings are shared across devices versus personal.
- Supported electrical scenarios and custom-component behavior declarations.
- Revision retention and storage quotas.
- PDF library, label stock formats, and large-diagram pagination defaults.
- Baseline and rollout thresholds for AI correctness, latency, and cost.

## Completion criteria for the roadmap

The roadmap is complete when all six features meet their acceptance criteria, legacy designs remain usable, critical editing/saving/export paths pass end-to-end checks, the new calculation engine drives every electrical consumer, and deployed behavior is verified after the required build/restart.

The first implementation increment should establish the document controller and golden fixtures, then ship undo/redo. This creates the recovery mechanism needed for later AI repairs and revision restores while delivering an immediate improvement to daily use.
