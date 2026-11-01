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
Question caches include the current source-version hash. Failed inference needs
explicit retry and never repeats automatically.

## Validation

Research protocol tests cover authorization, leases/replay, original storage,
atomic publication and metadata, annual alias retirement, historical PDFs,
issuer/type/year filtering, retrieval ranking/diversity, model-off evidence,
answer/citation validation, caching and directory fallback. Nine Linux worker
tests cover URL, memory, document, period, conversion and disabled-model guards.
Existing portfolio tests and TypeScript checks pass.
The 28-case retrieval review set is in `scripts/research/evaluation-cases.json`.
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

Still required: verify corrected live coverage and useful evidence for all six;
exercise real unseeded onboarding; inspect responsive UI and originals; verify
live model inference with the owner's authorized sign-in. Model execution remains
explicitly disabled and `/home/azureuser/.codex` is inaccessible to this service.
No authentication has been restored.

## Operations and recovery

On the VM, inspect `systemctl status finn-research.service` and
`journalctl -u finn-research.service`. Configuration is read from the existing
owner-only `/home/azureuser/finn-personal/config.json`; never copy its token into
logs, command arguments, source or documentation. State/cache is under
`/var/lib/finn-research`; originals and page maps persist in R2. Cache is bounded
to 2 GiB. Document leases recover after ten minutes and allow at most two attempts.
Refresh from a company's Prepare documents button. The protected worker bootstrap
also accepts `refresh: true` for the six seed companies, deduplicating active jobs.

Stop/start only `finn-research.service` to pause/resume ingestion. The separate
`finn-collector.timer` remains the ordinary data collector; the old model worker
and cloud monitoring automation remain disabled/paused. Never enable model access
or remove the credential-path restriction without the owner's sign-in action.

Deploy through the Sites source workflow and preserve owner-only access. Schema
migrations are append-only; 0001 contains FTS5 and preparation deduplication, and
0002 adds per-version source metadata. Application rollback must retain these
tables and R2 artifacts. Do not drop the database or rewrite applied migrations.
