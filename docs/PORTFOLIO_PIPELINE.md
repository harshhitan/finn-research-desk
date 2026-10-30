# Portfolio monitoring and independent ChatGPT integration

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

## Unattended writer

An enabled hourly Site schedule is linked as `FINN portfolio monitoring`
(`Automation_ad78e94f63288191846884801456066c`, Asia/Calcutta). The scheduling
service rejected a 30-minute interval because it allows at most one run per hour.
Schedule creation proves configuration, not a completed cloud execution.

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
