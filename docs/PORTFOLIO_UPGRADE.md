# Portfolio and briefing upgrade

Owner-authorized scope, 3 November 2026: proactive portfolio interpretation now
replaces the previous on-demand-only filing setting. Research questions keep
their existing workflow. The old standalone model service stays disabled; the
serial research VM worker handles automatic and requested portfolio work.

Completion requires current evidence for all of the following:

- Compact daily overview, explicit EOD/session freshness and source coverage.
- Windowed digest with transparent priorities, related-results grouping,
  retained originals/amendments and accessible routine disclosures.
- Automatic cached AI interpretation on disclosure cards, important items first,
  without an Analyse click. Clear preparing/failure states and controllable mode.
- Bounded background processing after the browser is closed, deduplication,
  restart recovery, accounting of attempts and retained memory/concurrency caps.
- VM extraction for important PDFs; notice-only interpretations clearly labelled
  when attachment evidence is unavailable. No invented PDF evidence.
- Improved structured prompt, evidence retrieval, review/repair and readable
  Markdown; verified inputs and deterministic financial comparisons.
- Results presentation for Revenue/EBITDA/PBT/PAT and compatible QoQ/YoY periods.
- Source-backed management background when present, explicit gaps otherwise.
- Company detail view, company-specific disclosures/alerts and research link.
- Readable actionable alerts with persisted thresholds and evidence access.
- Relevant filing questions supported by the same evidence-first approach.
- Automated checks, real automatic processing, published desktop/mobile QA,
  owner-only sharing, unchanged research capability and operational documentation.

Verification evidence will be recorded as implementation progresses. This file
is a checklist, not a completion claim.

## Release and verification, 3 November 2026

- Initial private release: commit `cd7c6783385c07b03b30ed5b6bdf3c18abc67e64`,
  deployment `appgdep_6ae972ae8b208191bd5cad08a1b9ff8c` succeeded at 05:36 UTC.
  Sharing remains one owner, no external visitors.
- Installed worker `research-2.14`, SHA-256
  `ea8dda9b97067ccf9f5e3f788872182d0f235ffbdeb1fed9a877538ee6e92c47`.
  All 29 Linux worker tests passed; the shared transport's six tests passed.
  Automatic interpretation enabled with routine notices included and a daily
  allowance of 100 attempts (IST reset). The old standalone model service and
  cloud automation remain disabled; the source collector timer remains enabled.
- Seven real completed-session market observations were interpreted and saved
  automatically without an Analyse click. The latest observed worker had no
  automatic restarts, no OOM or max-limit events, and about 192 MiB cgroup usage.
- A real Fine Organic filing question completed on its first attempt. The answer
  separated consolidated/standalone quarterly tables, identified acquisition
  scope changes, and opened its supporting PDF passages. Repeating the same
  question returned the cached answer rather than another model request.
- Published checks verified alert save/snooze/restore, company-specific
  developments, and the Reliance research deep link. Existing research still
  reports its eight registered companies and online on-demand model.
- SQLite/protocol tests cover automatic opt-in, owner isolation, stable identity,
  priority and serial leases, source preparation, review before publication,
  notice labelling, question isolation, deterministic comparisons, bounded
  recovery, pause and IST daily allowances. SSR tests cover grouped cards,
  Markdown, executive evidence, questions and alert actions. TypeScript passes.
- Real local D1 testing caught long-prefix LIKE limits; prefix range queries
  resolved the failure. A live-release follow-up fixes admission accounting so
  existing pending jobs cannot displace new work, and makes the evidence drawer
  read cached source text without starting PDF extraction in a web request.

Initial backfill remains an observable queue, not a claim that every historical
filing is already interpreted. Automatic financial-result verification and final
published mobile checks are recorded below when completed.

## Capacity incident and corrective release

The 3 November run exposed a shared provider-limit failure: all 89 worker failure
records since 05:36:30 UTC were exactly `usageLimitExceeded`. The 33 unfinished
automatic jobs with prior attempts also summed to 89, with no other failure
reason in that service interval. Eleven automatic interpretations had succeeded.
The provider subsequently reported available capacity again; the local 100-attempt
allowance was still exhausted by the rejected calls.

Worker `research-2.15` adds a private persisted cooldown, using the provider's
reported reset time when available and bounded exponential waiting otherwise.
It stops claiming both research and filing work during that wait. Quota-rejected
work returns to a waiting state without consuming a filing retry or local daily
allowance. Heartbeats expose only the waiting reason/time, never account secrets.
The frontend distinguishes a daily allowance wait from actual preparation.
The Linux suite now has 32 passing tests, including cooldown persistence across
restart, read-only reset-time lookup and quota deferral. Research/portfolio SQLite
tests cover deferred questions, refunded rejected claims and idempotent audited
capacity recovery. An operator must stop the model worker, audit the journal and
exact affected job attempts, then use `private-worker/recover-capacity` with those
IDs/count/day and a unique incident key. Its durable receipt prevents a duplicate
refund. No general SQL or account-reset operation is exposed.

The corrective release also separates call-recording notices from actual result
filings before prioritisation, updates pending priorities without creating new
jobs, and retains independently verified primary periods when another optional
model detail fails validation.
