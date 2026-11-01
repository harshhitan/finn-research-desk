# Pull research implementation status

Active implementation, 1 November 2026. Full completion remains unproven until
the live model path and final company coverage have been verified.

Sites' canonical URL is now
https://finn-reliance-research-desk.anandharshitwork03.chatgpt.site/research.
The prior cozyjay15 URL redirects. Both VM clients use the confirmed new fixed
origin, retain no-redirect credential handling, and share the existing private
configuration. The collector status check on this origin returned 20 quotes,
190 filings, 711 completed collection jobs, zero pending jobs and no source errors.

## Running implementation

The owner-private Site has a generic company library, protected APIs, D1 FTS5
retrieval and R2 PDF/page artifacts. Six seed companies have completed their first
ingestion: RELIANCE, TCS, INFY, HINDUNILVR, LT and NTPC. The separate VM service
`finn-research.service` runs outbound only, with no MCP, inbound server or
personal-computer dependency. New ticker discovery uses the NSE directory, with
a cached Screener lookup and matching linked NSE identity when NSE is unavailable.
When hosted lookups fail, a bounded directory request runs on the VM and the UI
polls its cached, verified result. No personal computer proxy is involved.
The old Reliance desk and saved research remain available.

The worker uses standard-library Python, Poppler page batches and optional bounded
Tesseract OCR. Heavy layout models and embedding services are unnecessary for
this VM. MemoryHigh is 192 MiB, MemoryMax 256 MiB, swap maximum 128 MiB, CPU quota
one CPU, and one preparation job runs at a time. Low available memory defers work.
The first six-job run had zero service restarts and a 194 MiB cgroup peak (includes
conversion subprocesses); the 360-page TCS benchmark took 5.1 seconds for text
extraction with 26.1 MiB parent and 20.8 MiB child peak RSS.

## Data-quality corrections under verification

The first live inspection found alternate PDF formats counted as two report
years, neighbouring link context leaking into fiscal periods, stale Infosys
annual selection, and old NTPC call filenames ranked as current. Parser v2 reads
periods from the document opening, prioritises explicit source years, counts
distinct verified periods, excludes annual investor meetings and recordings,
and publishes annual reports by fiscal year. Immutable per-version metadata is
staged before atomic publication. Historical originals survive supersession.
Successful v2 preparation retires the old v1 selection from current retrieval.

Retrieval filters company/type/year before searching, reranks operating-cash
evidence and limits repeated pages/documents. Model answers must supply exact
quotes and known passage IDs; unsupported numerical claims are rejected.
Question caches include the current source-version hash, configured model and
explicit prompt/retrieval/validation versions. Retrieval verifies a stable source
snapshot before queuing inference. Failed inference needs
explicit retry and never repeats automatically.

## Validation

Research protocol tests cover authorization, leases/replay, original storage,
atomic publication and metadata, annual alias retirement, historical PDFs,
issuer/type/year filtering, retrieval ranking/diversity, model-off evidence,
answer/citation validation, caching and directory fallback. Twenty-two Linux worker
tests cover URL, memory, document, period, conversion, disabled-model guards and
private failure diagnostics, staged indexing recovery and serial question
checkpoints after conversion. Staged uploads resume only a contiguous ordinal
prefix; holes force idempotent replay and cannot be published as complete.
Existing portfolio tests and TypeScript checks pass.
The 30-case retrieval review set is in `scripts/research/evaluation-cases.json`.
Run `evaluate.py --output /var/lib/finn-research/evaluation.json` on the VM after
preparation; it calls the protected read-only evidence check and records source
IDs, versions, pages, excerpts, latency and scope violations. A nonempty retrieval
result is not proof that the question is answered; review semantic support too.
The initial live 28-case run found no company/year/type scope violations and
returned zero passages for both deliberately absent 2099 periods. It also
confirmed stale v1 Infosys periods, so this is a diagnostic baseline, not final
acceptance. Inspection of Reliance's cash-flow page showed that table headers
and totals can fall in separate chunks; retrieval now includes bounded same-page
header/continuation chunks with their own original citation IDs.
Original delivery supports bounded byte ranges and HEAD requests for PDF viewers.
The protected ingestion credential can verify stored originals through the same
read-only route; it cannot use that exception to read visitor question history.

Still required: verify final corrected coverage and useful evidence for all six
and complete real model-answer validation. Coforge has published its first report;
its saved question automatically advanced to waiting_model without a browser poll.
The original PDF viewer has been visually verified at its cited historical page.
The owner explicitly authorized on-demand answers and completed VM sign-in.
Model startup succeeded under a 192 MiB memory cap: 88 MiB child and 20.2 MiB
parent peak RSS. The configured gpt-6.1-sol model is available. Base installation
remains model-disabled; the optional model profile permits credential refresh only
after authorization. No scheduled model monitoring is enabled. The first real
answer attempt failed and was withheld; startup success is not answer acceptance.
Worker research-2.3 retains one bounded, owner-only diagnostic containing the
failure stage, safe reason, rejected answer and supplied public passages. It
excludes credentials and leases and never publishes a rejected answer to history.

On 1 November at approximately 11:13 UTC, an explicit retry produced the first
accepted live answer, for Coforge's business segments and revenue drivers. Manual
review confirmed the FY2024 consolidated segment excerpt (PDF page 268) and the
FY2026 service-category excerpt (PDF page 156). The answer explicitly labelled
historical information and withheld unsupported current growth-driver conclusions.
Repeating the identical request returned SAVED ANSWER, reusing the validated run.
This is one reviewed answer, not the complete evaluation suite. The initial
failure reason predates private diagnostics and remains unknown. The service
stayed active with zero automatic restarts and a 195.1 MiB cgroup peak during this
run, under the 256 MiB cap.

The stricter call policy requires earnings context and dialogue in the PDF, not
merely a filing letter mentioning a transcript. Analyst days, fireside chats and
recording notices are excluded. Eligibility is cached by PDF hash and policy
version. Rechecks retire an older misclassified source only when its exact bytes
match; a newly broken or replaced URL cannot remove an older valid original.
Previously converted annual formats can be reactivated with their stored chunks
and provenance, avoiding a full upload on every refresh. Coverage now exposes
verified period counts and the latest source-check reasons. A company with
partially readable documents remains partial, and expired jobs reconcile company
status rather than leaving an empty library preparing indefinitely.
Interactive preparations take priority over background seed refreshes. Publishing
the first relevant document refreshes waiting questions without a browser poll.
When explicitly enabled, inference runs between documents and at bounded upload
checkpoints after converters have exited. It never overlaps a converter and
renews the preparation lease after returning. A model failure does not abort
ingestion. The live Coforge test above passed; wider answer evaluation remains.
Answer amounts must appear in the actual cited quotes, with negative signs and
accounting parentheses preserved. Numbers elsewhere on the same page cannot
validate a different quoted claim. This is still not a proof of semantic support.
Discovery cache keys use ticker, sources and policy version; progress/readiness
timestamps cannot invalidate the daily discovery cache.
Background connection errors have a separate, self-clearing status. Coverage
refresh retries even when the initial load fails, and successful question polling
clears its connection warning without clearing an unrelated user-action error.
The first FY2026 Reliance consolidated-cash question correctly withheld a value
because its selected passages lacked the total row; it did not substitute the
standalone figure. Original-page inspection located the consolidated total in a
different chunk on PDF page 142. Retrieval now gives the net-operating-cash row
and explicitly requested accounting scope priority over a table heading, and the
retrieval cache contract is `fts-neighbours-4`. The fresh live request returned
INR 1,92,113 crore for the year ended 31 March 2026, matching the original row.
It completed during resumed ingestion under the unchanged memory cap, with zero
automatic restarts. This is a numerical answer check, not generic calculation
support; the model still cannot invent ratios or calculate from unchecked facts.

Retained active transcripts are rechecked even after six new eligible quarters
have been found. This prevents an older Investor AI Day from surviving merely
because discovery filled the target first. The period verifier recognizes
"quarter and financial year ended". A verified period correction is persisted
to the active document/version metadata and changes the source-version cache
hash. Readiness requires verified source periods. Alternate formats for one
period are deduplicated; valid historical periods remain searchable and originals
are retained. Policy `quarterly-dialogue-2` versions this eligibility/period check.
Research history restores the saved year/source filters, and multiple quotes
from one passage produce one source button per finding.

The live Infosys guidance answer preserved Q2/Q3 FY2026 ranges and distinguished
the FY2027 outlook issued in the Q4 FY2026 call. It also exposed missing Q1
retrieval despite that transcript being indexed. Explicit multi-period requests
now gather bounded per-document candidates and select distinct periods before
filling remaining context (`fts-neighbours-5`). Missing search results have an
explicit company/filter-scoped empty state.

A live TCS answer was withheld because it exceeded four citations per finding
and included quotes shorter than twenty characters. The original prompt did not
state both limits. Prompt `research-3` now states every output budget and the
question job supplies a bounded JSON output schema. The installed CLI protocol
supports turn-scoped `outputSchema`; the shared transport forwards it only for
jobs supplying that contract. Server quote, number and provenance checks remain
mandatory. Three transport tests verify schema forwarding, unchanged legacy
filing behavior and denial of document-induced tool/approval requests. All three
and sixteen worker tests pass on Linux. The real TCS retry passed. HUL also
returned a supported consolidated segment/category answer and correctly
separated the discontinued Ice Cream business. Five companies now have accepted
live answers (Reliance, Coforge, Infosys, TCS and HUL); this does not replace the
source-review suite or the full completion audit.

The final NTPC check exposed stale quarterly coverage despite a numeric target
being met. Discovery policy `primary-links-3` removes the count-based early exit,
orders embedded fiscal years and compact filename dates without neighbouring
table-year leakage, follows two observed financial-year archive values, and uses
row context to distinguish presentations/notices from transcripts. The crawler
remains limited to sixteen pages. Research-2.7 also serves saved questions between
discovery requests, never concurrently with conversion.

Readiness checks two consecutive latest annual years (with publication time
through August), six calls from the last twelve completed fiscal quarters and a
call in the last four completed quarters. Older valid periods stay searchable.
Readiness degrades on read as evidence ages; no model scheduling is required.
The source panel exposes latest periods and recent call counts. These freshness
and live NTPC corrections still require publication and real refresh verification.

The 26-case review excluding NTPC returned no scope violations and empty results
for all three absent-2099 cases. Manual review found a broad HUL-category
retrieval miss and incomplete formal-segment context for some business questions.
`fts-neighbours-6` adds formal-segment/risk candidate queries, prioritizes formal
group segment notes and actual numeric cash total rows, and modestly prefers
recent business evidence only when no year was requested. These corrections
must be reviewed against the real corpus. `evaluate.py --ticker` supports bounded
company subsets and retains full passages plus original URLs for manual review.

## Operations and recovery

On the VM, inspect `systemctl status finn-research.service` and
`journalctl -u finn-research.service`. Configuration is read from the existing
owner-only `/home/azureuser/finn-personal/config.json`; never copy its token into
logs, command arguments, source or documentation. State/cache is under
`/var/lib/finn-research`; originals and page maps persist in R2. Cache is bounded
to 2 GiB. Document leases recover after ten minutes and allow at most two attempts.
Refresh from a company's Prepare documents button. The protected worker bootstrap
also accepts `refresh: true` for the six seed companies, deduplicating active jobs.
Use `reconcile: true` to recompute their readiness without adding jobs. For a
planned worker update, first stop the service, then call the protected
`maintenance/yield` operation with the expected running job ID and
`reason: worker_update`, install the checked worker, and start the service.
Published/staged data is retained; the handoff invalidates the previous lease and
does not charge a planned update against the two failure attempts. Never yield a
lease while its original service is still running.

Stop/start only `finn-research.service` to pause/resume ingestion. The separate
`finn-collector.timer` remains the ordinary data collector; the old model worker
and cloud monitoring automation remain disabled/paused. Install the optional
`scripts/research/finn-research-model.conf` profile under
`/etc/systemd/system/finn-research.service.d/` only after owner authorization and
sign-in. It enables user-requested inference and permits the official credential
store to refresh, while ProtectHome stays read-only elsewhere. The collector's
credential-path restriction stays in force. Never print or copy the auth cache.

Deploy through the Sites source workflow and preserve owner-only access. Schema
migrations are append-only; 0001 contains FTS5 and preparation deduplication, and
0002 adds per-version source metadata; 0003 adds preparation priority and promotes
existing waiting user questions. Application rollback must retain these
tables and R2 artifacts. Do not drop the database or rewrite applied migrations.
