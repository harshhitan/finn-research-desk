# Portfolio monitoring and independent ChatGPT integration

## Personal VM mode — 31 October 2026

The owner clarified that FINN is for personal use. The Site retains its owner-only
audience. This mode uses the official Codex client on the owner's Azure VM and an
independent FINN worker, with no Hermes import and no Codex credential-file reads
by FINN. The older hosted OAuth adapter below is a separate, disabled mode.

Set `FINN_PRIVATE_CODEX_OWNER` to the actual Site identity from the existing
portfolio preferences and `FINN_PRIVATE_CODEX_MODEL` to a model discovered through
the installed client's `model/list`. Personal worker service access uses the
existing `FINN_MONITOR_JOB_TOKEN` and Sites service-access header.

`scripts/private-codex-worker.py` uses outbound HTTPS polling; it opens no inbound
port. Its mode-0600 config contains the exact Site URL and service token. Run it
from an empty dedicated work directory using Python 3. The official Codex client
handles subscription login/refresh. The worker uses stdio, disables execution,
browser, search and app tools, denies approval requests, and restricts filesystem
reads to the work directory plus platform-minimal paths through a named permission profile. Instruction-file discovery is disabled; FINN supplies its complete analysis instructions. Model calls run sequentially with a
180-second deadline. Failed work retries at most three times automatically.

Owner requests queue existing exchange filings, never arbitrary remote prompts.
The worker receives bounded, extracted passages. Results return with a random,
expiring job lease and are revalidated against the document hash, exact quotes,
figures, currencies and periods before being persisted. Replays, another account's
requests, changed documents and fabricated evidence are rejected. Repeated source
hash/model/schema combinations reuse verified analysis. Queue capacity is ten
pending jobs; the application also checks a rolling request budget.

The connection panel reports fresh worker heartbeats. Online status alone is not
proof of successful financial extraction; verify a real filing through the whole
queue and inspect its saved citations. Configuration of the private worker does
not mark the older hosted OAuth registration approved.

This is FINN-authored code. There is no Hermes import, credential adoption,
shared third-party OAuth client, `~/.codex/auth.json` read or personal-login proxy.
The existing Sites visitor authentication remains in place. A separate model
consent transaction is linked to that verified visitor, not used to replace it.

## Required external authorization

Hosted subscription inference is **not activated** by ordinary Site sign-in.
The owner confirmed on 30 October 2026 that FINN does not yet have approved hosted
ChatGPT-plan registration. The adapter therefore fails closed by default.
Do not present a disabled connection as working LLM inference.

Register the exact callback:
`https://finn-reliance-research-desk.cozyjay15.chatgpt.site/api/portfolio/chatgpt/callback`

Set only the values actually granted to FINN through native Sites runtime settings:

- `FINN_CHATGPT_HOSTED_APPROVED`: `true` only after hosted inference authorization.
- `FINN_CHATGPT_CLIENT_ID`: FINN's issued `oaiapp_…` client ID.
- `FINN_CHATGPT_REDIRECT_URI`: the exact registered callback above.
- `FINN_CHATGPT_SCOPES`: approved identity, offline-access **and inference** scopes;
  these must come from the hosted registration, not copied from the OSS flow.
- `FINN_CHATGPT_TOKEN_AUTH`: `none` or `client_secret_basic`, as provisioned.
- `FINN_CHATGPT_CLIENT_SECRET`: confidential-client secret, if provisioned.
- `FINN_CHATGPT_ENCRYPTION_KEY`: random 32 bytes, base64url encoded, server-only.
- `FINN_CHATGPT_MODEL`: an actually entitled model ID; no hardcoded entitlement.
- `FINN_MONITOR_JOB_TOKEN`: independent server-side secret for unattended collection.

Never put credentials in this document, source, manifests or the browser. OAuth
state is random, PKCE S256 and nonce are mandatory, transactions expire after ten
minutes and are atomically consumed once. ID signatures, issuer, audience,
expiration and nonce are verified. Tokens use AES-256-GCM with the visitor ID as
associated data; a per-user lease serializes token refresh/model calls. Disconnect
deletes credentials and cancels queued analysis. It does not revoke the upstream
grant; users can manage that grant in ChatGPT settings.

The Responses adapter uses `store:false`, `stream:true`, supplied filing passages
and completion verification. It rejects missing/fabricated quotes and unsupported
financial units/numbers. It never substitutes model memory, news or estimated data.
Source interpretations remain model interpretations, not deterministic proof.

Official contracts checked:
- https://developers.openai.com/siwc/website
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

The hosted partner's provisioned inference contract must still be checked at
activation; the published OSS preview contract does not establish hosted access.

## Collection and durable state

20 fixed Indian NSE companies cover 20 business industries, including large
issuers and smaller businesses such as Kaveri Seed, Fine Organic and C.E. Info
Systems. No numerical market-cap classification is asserted. Ticker/ISIN identity
was checked against the official NSE equity directory on 30 October 2026.

NSE corporate-announcement API is primary. The latest NSE RSS is a visible,
partial fallback, not historical coverage. Collection backfills 30 days initially,
then overlaps the previous successful watermark by two days. Prices are public
Yahoo daily sessions, with currency/instrument identity checked, intraday sessions
removed, prior-20-session volume baseline and split guards.

D1 retains companies, filings, observations, source health, jobs, rules, alerts,
document-text cache and per-user analyses. IDs and identical attachment URLs
deduplicate repeated ingestion; new attachment versions remain distinct. Content
hashes invalidate cached analysis. Jobs use atomic claims, expiring leases, bounded
chunks and retries; exhausted failures remain visible. Prices/filings already
collected are retained on partial provider failure. No exchange completeness or
instant notification guarantee is made.

The digest defaults to 24 hours, supports a custom window and company filter,
sorts important items first and collapses routine items. Rules include price,
volume, categories, priority and company selection. Alerts are persisted in-app,
not email or device push. New rules do not retroactively manufacture filing alerts.

## Unattended writer — ordinary VM timer

The former ChatGPT cloud task `FINN portfolio monitoring`
(`Automation_ad78e94f63288191846884801456066c`) is paused, verified on 1 November
2026. Leave it paused. Its earlier run evidence below is historical.

Collection uses `finn-collector.timer` on the Azure VM, hourly around :35 IST,
with a Python standard-library runner and no AI agent or ChatGPT login. Operational
source and rollback instructions are in the workspace's `ops/` directory.
The old scheduled Codex interpretation worker remains stopped/disabled.
Separately authorized on-demand Pull answers use the research service; see
[PULL_OPERATIONS.md](PULL_OPERATIONS.md).

The timer calls `POST /api/portfolio/jobs/run?kind=collect`, then
`GET /api/portfolio/jobs/status?kind=collect`. Both retain the existing service
authorization. The selector limits job claims, expired-lease recovery, pending
counts and status to collection jobs. It does not claim optional `analyse` jobs or
call a model. Existing interactive/default mixed processing remains available.
Collection may still enqueue optional analysis work for the existing model path;
the timer does not execute that work. Stored analyses and pending jobs are retained.

The runner preflights `jobKind: collect` before writing so an older deployment
cannot silently ignore the selector. It refuses redirects, bounds calls/time and
retries, prevents overlapping local invocations and records a protected status
file. systemd adds bounded run retries and one catch-up run after VM downtime.
Collection requires the VM to be running; Site credential rotation requires
updating the existing protected service config.

### Historical cloud scheduler verification

An hourly Site schedule was linked as `FINN portfolio monitoring`
(`Automation_ad78e94f63288191846884801456066c`, Asia/Calcutta). The scheduling
service rejected a 30-minute interval because it allows at most one run per hour.
Schedule creation proves configuration, not a completed cloud execution.

The first scheduled cloud execution was subsequently verified in task run
`01a18cb2-f2f1-766c-bf68-4dd7c65bb0d1`: it retrieved this source revision's
instructions and Site service access, completed authenticated collector calls,
and read back HTTP 200 at 17:37:51 IST on 30 October 2026 with 20 quote series,
168 filings, zero source errors and 31 completed jobs. A transient initial
authorization attempt failed; the run recovered and completed the verified path.
This verifies a fresh scheduled executor, not just a saved schedule.

`POST /api/portfolio/jobs/run` requires `X-Finn-Job-Token` plus the Site's supported
service-access boundary. The configured job secret matches the Site's service
access credential, which a fresh scheduled task obtains through `get_site`.
Send that credential only to this Site in both `OAI-Sites-Authorization: Bearer …`
and `X-Finn-Job-Token: …`. If the Site service credential is rotated, update the
server secret and deploy before claiming the unattended writer is healthy.
It enqueues a new collection bucket and processes four
jobs per call. A scheduled cloud task must call repeatedly until `remaining` is zero
or a bounded run budget is reached, then read `/api/portfolio/jobs` / source health.
Use the Sites tool to retrieve service access at run time; never embed credentials
in the automation prompt. Preserve failed and retrying jobs. Routine runs do not
republish. Model analysis jobs are created only for connected user accounts and
watched material filings; collection works while the model connection is pending.

## Activation verification still required

Mocked auth/model tests prove protocol logic only. A real approved hosted client,
user consent, successful model turn, refresh, disconnect and an unattended cloud
run are required before claiming full subscription integration is complete.

## Results comparisons

Analysis schema version 2 records a separately cited primary reporting period and
period/duration/scope/definition context for each reported metric. A missing
current quarter never causes substitution of an older comparative quarter.
`GET /api/portfolio/filings/{id}/results` reads only the visitor's analyses and
withholds comparisons whose cached PDF content hash has changed.

QoQ uses the exact three-month prior quarter-end; YoY uses the same quarter-end
month a year earlier. Only explicitly reported three-month figures qualify.
Annual and YTD values are not divided or subtracted to manufacture a quarter.
Company, consolidated/standalone scope, accounting basis and metric definitions
must match. Current-filing comparative figures take precedence over older filings;
conflicting comparable figures are withheld. Exact INR unit conversions are
recorded, and zero/negative comparison denominators do not produce growth rates.
Each result exposes both source quotes/pages, document hashes, original values,
normalized inputs and its formula. The published UI shows missing-evidence states
until approved inference produces real source-checked analyses; no test figures
are seeded into production.

Comparison reads are bounded to the selected filing and 50 available analyses,
with truncation disclosed in the response and UI. The database returns only the
cached PDF's hash for invalidation, not its full text on every comparison read.
