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
- Production has not been switched. The current Site and VM configuration remain
  unchanged while the replacement is prepared.
- Neon project `square-moon-93983049`, production branch, database `finn` has the
  initial schema applied. The 29 tables are not yet populated from the live Site.
- The Node server, PostgreSQL adapter, signed public sessions, shared AI queue
  access and authenticated VM storage implementation are prepared in this checkout.
  The Render production build and TypeScript checks pass. Storage and session
  checks have run locally; deployment and real cross-service checks remain.
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

1. Complete GitHub authorization and push the reviewed source. Connect Render
   and select its destination workspace. Neon is already provisioned.
2. Finish PostgreSQL query verification and verify atomic leases under concurrent
   clients on an isolated branch.
3. Validate the Blueprint and configure protected server secrets on Render.
4. Verify visitor isolation and public model-queue access on the deployed server.
5. Install authenticated storage on the VM behind HTTPS, then verify Render can
   stream originals and artifacts with hashes and byte ranges intact.
6. Export the live data and originals, import into the destination, and verify
   counts, hashes, source links and owner/session mapping. Never import service
   tokens, OAuth credentials or stale active leases as ordinary application data.
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
