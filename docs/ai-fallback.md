# AI provider fallback

The production system-generation, iterative-generation, streaming-generation,
and AI Wire endpoints try the admin-selected primary model first. When its
provider has a billing, authentication, availability, rate-limit, connection,
or timeout failure, they switch to
`nvidia/nemotron-3-super-120b-a12b:free` on OpenRouter for the rest of that request.
Streaming calls use a 90-second inactivity timeout, reset whenever a provider
chunk arrives, including reasoning data. Non-streaming calls allow 120 seconds
for a completion before trying the backup. Automatic SDK retries are disabled.
The entire production run has a four-minute budget shared by the primary,
backup, and all correction passes. Reaching that deadline cancels the active
provider request without starting another fallback. An earlier usable primary
candidate is retained with `stopReason: run-deadline`; a request with no candidate
returns a deadline error (HTTP 504 for non-streaming endpoints).
Runs also stop at the requested pass count (at most six), stop on repeated
unsuccessful corrections, and cancel when the client disconnects or selects Stop.
Transport keepalives are sent every 15 seconds but never reset the model's
inactivity timer. Benchmark runs retain their own independent time limits.
HTTP 400, 403, and 422 rejections do not trigger fallback.

The existing `OPENROUTER_API_KEY` enables fallback automatically.
Set `AI_FALLBACK_ENABLED=false` to disable it. The primary admin setting stays
in place, so the next user request tries the primary again.

The backup uses reasoning disabled, JSON output, a 32,000 output-token cap,
and a provider price cap of zero. It receives text context only. Interrupted
primary streams restart the same iteration with a fresh buffer; primary and
backup JSON are never concatenated.

Backup designs must meet the requested quality score (70 by default) and have
no validation errors. Otherwise the API returns an error and leaves the
user's existing design in place. The shootout showed this model performed best
for wiring; complex system generation remains unreliable. See
[benchmark report](benchmarks/openrouter-free-2026-10-01/report.md).

Responses identify `aiModel`, `aiProvider`, and `usedFallback`. Streaming emits
`ai-fallback`, which the UI displays as a backup notification. Logs preserve
the original provider failure, routing decision, and usage per model. Free
backup tokens cost zero; any primary tokens retain their own model's pricing.
The primary failure also triggers the existing failure email path, even when
the backup succeeds. Email delivery still requires SMTP configuration; see
[alert setup](ai-failure-alerts.md).

The generation dialog shows planning, drawing, and checking stages, elapsed
time, last provider activity, received character count, and a live draft
diagram built from complete equipment and wire objects in the streamed JSON.
The preview is provisional; the saved design changes only on the final
`complete` event. A fallback clears the primary draft before backup data arrives.
