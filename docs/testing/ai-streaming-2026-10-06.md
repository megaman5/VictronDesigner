# Streaming activity and draft progress — October 6, 2026

Production AI calls now use a three-minute inactivity watchdog, reset by
provider chunks throughout streaming. The old 90-second per-call deadline
and four-minute overall run cutoff are removed. Pass counts, stagnation
detection, cancellation, and fallback validation remain in place. SSE comments
keep the connection open every 15 seconds without counting as model activity.

The generation dialog shows actual activity, elapsed time, planning/drawing/
checking stages, complete equipment and wire objects as a live draft, and
Stop generation. Partial drafts are never applied to the saved design. Fallback
clears the previous provider's draft, and late completion after cancellation
is ignored. Character counts are labeled as characters rather than tokens.

## Verification

- Targeted unit, integration, and functional coverage: 85 tests passed across
  seven files (the corrected final-completion fixture was rerun in its full
  seven-test functional file after the initial combined run).
- Simulated 12-minute active stream survives both former time limits.
- Three-minute silence triggers fallback before any output and after partial
  output; a partial primary response is discarded before backup generation.
- Completed and cancelled requests clean up watchdog timers.
- Draft parsing is checked at every character boundary, including nested
  objects, escaped strings, fenced JSON, and unusable equipment.
- Functional streaming tests verify incremental drawing, checking state,
  final application, fallback reset, cancellation, and unchanged canvas
  before final completion.
- `npm run check`, `npm run build`, and `git diff --check` passed.
- Production service rebuilt and restarted; local homepage returned HTTP 200.

## Visual evidence

The shared browser could not reach the remote server (public navigation timed
out and environment-port navigation returned connection refused). Visual checks
therefore used the exact progress component rendered with a deterministic
six-device/five-wire fixture and the production CSS. These are component visual
checks, not a live-provider end-to-end browser run.

- [Desktop fixture, 1280 × 800](ai-streaming-2026-10-06/desktop.png)
- [Mobile fixture, 390 × 844](ai-streaming-2026-10-06/mobile.png)
- [Browser recording](/home/sean/.t3/userdata/attachments/46897289-fd2f-429b-9b9f-83f1aeb2feef-da8e83f8-8d6e-4bb9-9e09-092eafeac4fb-mp4.mp4)

Mobile check: document width remained 390 pixels, all six equipment shapes and
five wire paths rendered, and the Stop button remained inside the viewport.
The live provider's latency and reasoning-data behavior were not exercised.
