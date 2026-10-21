# Review and routing fixes — 2026-10-04

Changes:
- Ignore blank saved requirement notes and blank prompts.
- Fingerprint the JSON request representation, including cleared optional fields.
- Hide previous issue counts and issues after an unsuccessful or outdated review.
- Model Blue Smart Charger DC output separately from its declared AC input current.
- Name unsupported equipment in unresolved circuit messages.
- Route both canvas views through a shared planner with actual component dimensions, stable wire/terminal order, busbar exits and live drag previews.
- Avoid grid steps that immediately reverse toward terminal anchors; remove redundant collinear points.
- Correct fuse operating-margin suggestions and explain solar-only recharge estimates.

Validation:
- TypeScript check passed.
- 160 tests passed across 11 review, electrical, PV, routing, validator, properties, transition and installation-package suites.
- Added a further busbar tie-order regression test after that run.
- Read-only replay of the saved “Seans System” (15 components, 27 wires): 25 known wire currents, two unresolved charger AC input conductors. No shared-engine conductor-sizing errors. Remaining notices concern the missing battery disconnect, solar recharge time, and panel position at the canvas edge.
- No saved design was changed. The charger’s maximum AC input rating must come from its label/datasheet; it is now editable in Charger Specifications.
- Collaborative browser status succeeded, but evaluate/snapshot failed and opening the preview timed out. Visual screenshots and a recording could not be captured in this session. Routing equivalence and interaction-state preservation were checked with automated tests.
- The additional busbar regression passed (15 routing/3D tests in that run).
- Production build completed; service restarted and is active. Homepage and live `/api/validate-design` returned HTTP 200. The live review fingerprint matched the request, analyzer version was 1.2.0, and the saved design returned 25 known wires with only the two specific charger AC input warnings unresolved.
