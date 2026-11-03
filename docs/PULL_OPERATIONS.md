# Pull operations and recovery

The published Site, D1/R2 and outbound VM service form the runtime. Closing this
chat or shutting down the personal computer does not stop them. The VM must be on.

## Components and configuration

- Site: preserve project ID `appgprj_6ae309799f40819189757b5e085ba3ce` and its owner-only access.
- Bindings: DB and BUCKET. Apply only new generated Drizzle migrations during publication.
- Research code: `/home/azureuser/finn-personal/research/worker.py`.
- Shared model transport: `/home/azureuser/finn-personal/worker.py`.
- Protected config: `/home/azureuser/finn-personal/config.json`, mode 0600, containing the canonical Site URL and existing service credential. Never put its value in shell arguments, logs, screenshots or Git.
- State/cache: `/var/lib/finn-research`, mode 0700. Originals and indexed versions are durably stored in R2/D1; the VM cache is an optimization.
- Service template: `scripts/research/finn-research.service`, installed as `finn-research.service`.

A fresh compatible Linux VM needs Python 3, Poppler (`pdftotext`/`pdfinfo`) and
Tesseract. The model transport uses the official Codex CLI; the tested VM version
is 0.166.0. The transport supplies its restricted permissions directly on startup;
no broad shell/browser tools, MCP configuration or local layout model is needed.
Install code and a private service config at the paths above, install/enable the
systemd unit, then queue seed preparation with the protected bootstrap operation.
Do not run research converters concurrently with model requests.

## Model access

The base service is model-disabled and cannot access the Codex credential store.
Only after owner authorization should the optional `finn-research-model.conf`
profile be installed as a systemd drop-in. The owner completes device sign-in;
credentials remain in the official VM account store. Never copy them to the
Site, local computer, repository or another account. The current owner explicitly
authorized this profile and completed sign-in.

Model availability checks do not request inference. Inference is serial and
claims saved owner questions, requested filing analyses and owner-enabled
automatic portfolio interpretations. Requests are marked in `provider_cache`
under `portfolio-request:<job-id>`; legacy unmarked queue entries stay paused.
Collection queues automatic work only while that independent setting is enabled;
collection itself never calls a model. Manual failures require an explicit retry;
automatic failures and interrupted leases retry at most three times. The optional
profile permits official credential refresh. Turning it off preserves stored
answers and indexed evidence; unanswered requests wait for availability.
On 3 November 2026 the owner explicitly enabled proactive portfolio AI as a new
scope. `portfolio-auto:<owner>` stores that independent enabled flag, routine
notice preference and daily filing-attempt allowance. Important disclosures are
processed before routine notices, with cached results and at most three attempts.
The same serial research service now prepares exchange PDFs in bounded page
batches, retrieves relevant evidence, interprets, reviews and optionally repairs
the result. Explicit research/filing questions take priority. Automatic work can
be paused independently in Portfolio → AI settings; saved answers remain usable.
No cloud LLM automation or second model service is required.

The old `finn-personal-worker.service` remains disabled. The collection-only
`finn-collector.timer` is independent and must not be replaced with an LLM timer.

## Health checks

```sh
systemctl show finn-research.service -p ActiveState -p NRestarts -p MemoryCurrent -p MemoryPeak -p MemoryMax
systemctl is-enabled finn-personal-worker.service
systemctl is-enabled finn-collector.timer
cat /sys/fs/cgroup/system.slice/finn-research.service/memory.events
```

The intended limits are MemoryHigh=192 MiB, MemoryMax=256 MiB, swap=128 MiB,
CPUQuota=100% (one CPU), TasksMax=32. The worker defers ingestion below 180 MiB
available RAM and inference below 220 MiB. Converter children have additional
address-space/CPU/output limits and finish before inference. `high` memory events
mean pressure throttling; `oom`/`oom_kill` indicate failures that require diagnosis.
The verified current service has zero OOM/max-limit events and zero automatic
restarts. These safeguards and measurements are not a guarantee against every
possible host outage.

Inspect Sources & coverage and source checks for unreadable pages, challenges,
missing periods or network errors. An HTTP-200 CAPTCHA page is a source failure,
not an empty successful archive. Do not bypass verification. Discovery stops on
that host and backs off; another independent primary source may be used.

## Safe updates and failure recovery

Ask FINN uses `research-agent-1`: the VM asks the model to structure the question
and select backend tools, executes at most four calls per round for two rounds,
then requests a cited Markdown answer. All turns are serial and run only for a
saved user question. `question/tools` is owner/lease/source-version bound. Tools
can search/read indexed evidence, verify financial totals, compare periods and
calculate reported profit/revenue margins. There is no arbitrary code execution.
Derived claims must reference a saved calculation and cite the original input
amounts. The answer displays formulas/inputs/sources; the standalone calculator
panel has been removed. Workflow progress lives in `provider_cache` under
`research-workflow:<question-id>` and old answers remain readable. Prompt/tool
changes invalidate answer cache keys. A run may make up to four serial model
turns (including one optional repair after citation/numerical validation), so its latency/usage can exceed the earlier single-pass answer.

Run the Linux worker tests and shared transport tests before installation. Verify
staged hashes. Avoid restarting during an active model turn; a stopped inference
is never automatically repeated. Stop the research service before changing its
code. If a preparation was running, use the protected `maintenance/yield` operation
with the exact observed job ID and `worker_update` reason only after stopping.
That invalidates the lease, retains staged/published data and refunds the planned
attempt. Install tested files and restart in a `finally` path.

Ordinary worker loss has bounded lease recovery and retries. Original hashes,
conversion versions and contiguous chunk prefixes allow reuse/resumption. A
staging hole forces idempotent replay. A version becomes searchable only after
validated publication. Source exclusions retire only the exact checked hash;
a newly broken URL cannot remove a valid historical original. Verified period
corrections invalidate source-dependent caches. Aliases require an existing
canonical ticker or a verified ISIN match; never merge companies by similar names.

Model errors remain private, bounded and safe in
`/var/lib/finn-research/last-model-failure.json` (0600). The record excludes auth
material and leases; never upload the official credential store or raw provider
bodies. Check its question ID/stage against current state: an old diagnostic can
remain after a later success. Provider error codes are allowlisted. New successful
answers persist provider-reported token counts through server normalization.

Use the retry button only for a specifically failed question after diagnosing
it. Do not loop model retries. Evidence remains available during provider failure.
For a source outage, use the existing preparation/status flow and its backoff;
never restart work solely because a status observation timed out.

## Evaluation and publication

On the VM, `evaluate.py --output /var/lib/finn-research/evaluation.json` captures
the 30 read-only source-review cases without calling a model. `--ticker` may be
repeated for targeted checks. Review the actual passages and periods; nonempty
retrieval is not acceptance. The checked-in final review explicitly preserves
partial and missing evidence.

Publish source and an exact matching build archive through the Sites workflow,
preserving owner-only access. If a save already returned a version/deployment ID,
resume that operation instead of creating another. Roll back to a previously
verified saved version if necessary; retain database history and historical PDFs.
The root README documents fresh local setup and the checks; production and local
preview databases are independent.
