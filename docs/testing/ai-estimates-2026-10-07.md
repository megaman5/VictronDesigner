# Editable AI estimates — October 7, 2026

Estimated physical wire lengths are ordinary design inputs. They are used for
current sizing and voltage-drop checks, remain labeled as AI estimates in
Properties, and no longer create one unresolved warning per wire. The review
shows a single informational estimate count. Users can edit lengths directly
or request length changes through AI Iterate.

Saved prompt text and design assumptions remain AI context. They no longer
create blanket manual-review issues or prevent the structured requirement
checks from completing. Specific missing requirements, sizing errors, and
unsupported electrical calculations remain visible.

Explicit length requests now survive both the repair-preservation step and
final annotation. Unrelated edits preserve existing user-supplied lengths.
The shared AI instructions ask for practical one-way cable runs in feet with
routing and service slack, and conductor sizing based on those lengths.

Disconnected-equipment warnings now trigger correction passes and appear in
repair feedback. Generic needs-review stop reasons have been replaced with
specific supported-checks-complete or unsupported-calculations reasons.

Verification:

- 81 targeted tests passed across policy, requirements, skills, review UI,
  provider-failure endpoints, requirement endpoints, and streamed generation.
- The review UI's 11 tests were rerun after the final wording adjustment.
- TypeScript and whitespace checks passed.
- Reanalyzing the saved 30-component/46-wire RV design from October 7 at
  16:54 UTC reduced unresolved items from 55 to 7. The remaining seven are
  specific unsupported calculations. The new continuation decision identifies
  the disconnected Cerbo and requests another pass instead of stopping.
- No live AI generation or user-design mutation was performed during this
  verification; the saved example was read and analyzed locally.
