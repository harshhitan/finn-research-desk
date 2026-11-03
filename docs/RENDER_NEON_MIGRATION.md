# Render + Neon + existing VM

Approved architecture: the same FINN application runs on Render, Neon PostgreSQL
stores structured data and the retrieval index, and the existing VM retains PDFs,
document processing and restricted model transport. Visitors may ask AI questions
without ChatGPT sign-in. Visitor histories remain separate; administrative controls
and service credentials remain private.

## Current implementation status

- `db/neon/001_initial.sql` includes all five existing database migrations and
  the portfolio runtime tables, with a PostgreSQL full-text index.
- `scripts/neon/migrate.mjs` applies migrations transactionally, checks previous
  checksums and serializes concurrent migration attempts with an advisory lock.
- Render service `srv-dbkvco1srm7s73b9a9ag` is live at
  https://finn-research-desk.onrender.com in the confirmed My Workspace,
  Singapore, on the free plan. The GitHub source is
  https://github.com/harshhitan/finn-research-desk, branch `main`.
- The existing Site remains public. Its VM research worker and collector have
  not been switched to Render. The new worker configuration is staged privately
  on the VM, separate from the existing configuration.
- Neon project `square-moon-93983049`, production branch, database `finn` has the
  initial schema applied. Existing live Site data has not yet been imported.
- The Node server, PostgreSQL adapter, signed public sessions, shared AI queue
  access and authenticated VM storage implementation are prepared in this checkout.
  The Render production build and TypeScript checks pass. Live health, homepage,
  research and portfolio API requests return 200 without ChatGPT sign-in; the
  server issues signed visitor cookies.
- `finn-storage.service` is installed on the VM behind Caddy, with bounded memory.
  Existing PDF HEAD and byte-range reads pass locally, and anonymous reads return
  401. Azure inbound ports 80/443 remain blocked, so public HTTPS certificate
  issuance and Render-to-VM document access are not verified yet.
- Worker heartbeats stay in process memory on Render. Visitor API activity wakes
  durable queue checks immediately; idle workers probe periodically so restarts
  can recover pending work without constantly querying Neon. This behaviour still
  needs verification with the live worker.
- SQL preparation against Neon validated 160 static queries. Remaining query
  validation and real lease/concurrency checks are incomplete.
- The collector and research worker accept an explicit `FINN_RESEARCH_SITE_URL`.
  Set it to the exact new HTTPS origin together with the protected config URL
  during cutover. Their default remains the existing Site.

## Required before cutover

1. GitHub authorization, source upload, Render workspace selection and initial
   deployment are complete. Keep secrets in protected server configuration.
2. Finish PostgreSQL query verification and verify atomic leases under concurrent
   clients on an isolated branch.
3. Both official Blueprint validators pass and Render server secrets are set.
4. Verify visitor isolation and public model-queue access on the deployed server.
5. Allow Azure inbound TCP 80/443, complete the VM HTTPS certificate, then verify
   Render can stream originals and artifacts with hashes and byte ranges intact.
6. Export the live data and originals, import into the destination, and verify
   counts, hashes, source links and owner/session mapping. Never import service
   tokens, OAuth credentials or stale active leases as ordinary application data.
   The Sites table-row reader truncates long chunk text; it is not a lossless
   export mechanism. Use a complete export or reindex the originals instead.
7. Update the VM's exact origin checks and endpoints after the Render URL exists.
8. Check real question/answer processing, automatic interpretations, calculations,
   citations, visitor isolation, restart persistence and desktop/mobile rendering.

Only switch the live worker after those checks. Keep a rollback route to the
existing Site. No claim of completed migration is implied by this document.

## Secrets

`DATABASE_URL` is the Neon TLS connection string. Store it only in protected
server configuration. Separate migration privileges from runtime privileges when
provisioning. Render and VM service credentials must never enter frontend code,
Git history, documentation or logs.
