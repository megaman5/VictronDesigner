# AI provider fallback

The production system-generation, iterative-generation, streaming-generation,
and AI Wire endpoints try the admin-selected primary model first. When its
provider has a billing, authentication, availability, rate-limit, connection,
or timeout failure, they retry with `gemini-3.8-flash` at low reasoning effort
for the rest of that request (when that is also the primary, this is the same
model told to think briefly).
Streaming calls use a 180-second inactivity timeout, reset whenever a provider
chunk arrives, including reasoning data. Non-streaming calls allow 180 seconds
for a completion before trying the backup. Gemini thinks silently before its
first token; healthy production runs went quiet for up to 86 seconds, and the
old 90-second limit was cutting off normal answers (14 runs in one week). Automatic SDK retries are disabled.
The entire production run has a 280-second budget (under nginx's 300-second
proxy timeout) shared by the primary,
backup, and all correction passes. Reaching that deadline cancels the active
provider request without starting another fallback. An earlier usable primary
candidate is retained with `stopReason: run-deadline`; a request with no candidate
returns a deadline error (HTTP 504 for non-streaming endpoints).
Runs also stop at the requested pass count (at most six), stop on repeated
unsuccessful corrections, and cancel when the client disconnects or selects Stop.
Transport keepalives are sent every 15 seconds but never reset the model's
inactivity timer. Benchmark runs retain their own independent time limits.
HTTP 400, 403, and 422 rejections do not trigger fallback.

The existing `GEMINI_API_KEY` enables fallback automatically.
Set `AI_FALLBACK_ENABLED=false` to disable it. The primary admin setting stays
in place, so the next user request tries the primary again.

The backup uses low reasoning effort (it only gets the time the primary left),
JSON output, and a 32,000 output-token cap. It receives the design image too.
Interrupted
primary streams restart the same iteration with a fresh buffer; primary and
backup JSON are never concatenated.

Backup designs must meet the requested quality score (70 by default) and have
no validation errors. Otherwise the API returns an error, naming the actual
reason, and leaves the user's existing design in place. The gate applies only
to designs the backup itself produced: a primary draft from an earlier pass is
returned with its issues listed, like any primary result. Likewise, once a run
has a usable draft, a later provider failure (including both models failing)
ends the run with that draft instead of an error.

The backup is not started with less than 60 seconds of the run left, and on
late passes the primary's idle limit shrinks (never below 30 seconds) so that
60 seconds remain for it. On 2026-10-20 a pass-2 stall left the backup 10
seconds; it timed out, and the strict gate then discarded Gemini's pass-1
draft, so the user got only an error.

Why not the free OpenRouter model any more: `nemotron-3-super-120b-a12b:free`
was the backup until Oct 2026 and failed all 21 production fallbacks between
Oct 12 and Oct 19 (empty streams or designs that failed validation), adding
2-3 minutes of waiting before every error. Every one of those primary failures
was Gemini thinking past the idle limit, not an outage, so a quick-thinking
Gemini retry addresses the actual cause. Benchmarked as a backup would run
(core-designs, low effort, 2 passes, 2026-10-19):

| backup candidate | median score | no electrical errors | time per case |
|---|---|---|---|
| gemini-3.8-flash, low | 89 | 4 of 5 | 15-78s |
| gpt-5.5, low | 32 | 1 of 5 | 27-102s |

gpt-5.5 does well with full reasoning and many passes, but not in the ~100
seconds a backup gets. The trade-off: a genuine Google outage takes out both
primary and backup. The old shootout is kept for reference:
[benchmark report](benchmarks/openrouter-free-2026-10-01/report.md).

Responses identify `aiModel`, `aiProvider`, and `usedFallback`. Streaming emits
`ai-fallback`, which the UI displays as a backup notification. Logs preserve
the original provider failure, routing decision, and usage per model. Primary
and backup tokens are each priced at their own model's rate.
The primary failure also triggers the existing failure email path, even when
the backup succeeds. Email delivery still requires SMTP configuration; see
[alert setup](ai-failure-alerts.md).

The generation dialog shows planning, drawing, and checking stages, elapsed
time, last provider activity, received character count, and a live draft
diagram built from complete equipment and wire objects in the streamed JSON.
The preview is provisional; the saved design changes only on the final
`complete` event. A fallback clears the primary draft before backup data arrives.

Closing the generation dialog (Esc, outside click, X) only hides it; the run
continues in a floating progress panel. Only Stop cancels. Previously any
close cancelled the run, which caused 18 of 39 failures in one week.
