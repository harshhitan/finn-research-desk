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
- The existing Site remains public on its original version. The temporary
  authenticated export bridge was removed by restoring that version after export.
- The existing VM research service and deterministic collection timer now use
  Render. Research worker version is `research-2.16`; its heartbeat reports model
  access ready. The original Site configuration remains available for rollback.
- Neon project `square-moon-93983049`, production branch, database `finn` has the
  initial schema applied. The shared-data import committed with 8 research
  companies, 93 documents, 130 versions, 47,881 full-text chunks, 27 financial
  facts, 206 portfolio filings, 80 prices, 40 source records and 99 interpretations.
  Search index counts match all chunks, with zero missing document/version
  references. Database size after import was 182,657,024 bytes.
- The Node server, PostgreSQL adapter, signed public sessions, shared AI queue
  access and authenticated VM storage implementation are prepared in this checkout.
  The Render production build and TypeScript checks pass. Live health, homepage,
  research and portfolio API requests return 200 without ChatGPT sign-in; the
  server issues signed visitor cookies.
- `finn-storage.service` is installed on the VM behind Caddy, with bounded memory.
  Existing PDF HEAD and byte-range reads pass locally, and anonymous reads return
  401. The approved Azure inbound rule permits TCP 80/443 to this VM only;
  port 8891 stays on loopback. A public Let's Encrypt certificate is installed,
  and the Render backend successfully authenticated and read existing PDF metadata.
- All 86 distinct original PDFs referenced by the 130 ready/partial versions
  passed SHA-256 verification and have durable hard links outside the rotating
  download cache. Duplicate versions share the same original bytes.
- Worker heartbeats stay in process memory on Render. Visitor API activity wakes
  durable queue checks immediately; idle workers probe periodically so restarts
  can recover pending work without constantly querying Neon. This behaviour still
  needs idle/restart verification with the live worker. Health probes use an
  in-memory liveness response; database connectivity is checked once at startup
  so repeated health checks do not prevent Neon from suspending.
- SQL preparation against Neon validated all 256 previously captured static
  queries. Live question processing and financial calculations also pass; SQL
  preparation alone does not establish every dynamic path or concurrency case.
- Render's direct NSE API/RSS requests were unavailable, while both official
  endpoints returned 200 from the VM. The authenticated VM service now permits
  only those fixed NSE destinations, with bounded payloads, date ranges, timeouts
  and concurrency. It never forwards its service token to NSE. Render still
  validates company identity and records the original official source URLs.
- The collector and research worker accept an explicit `FINN_RESEARCH_SITE_URL`.
  Set it to the exact new HTTPS origin together with the protected config URL
  during cutover. Their default remains the existing Site.

## Verified behavior

1. GitHub authorization, source upload, Render workspace selection and initial
   deployment are complete. Keep secrets in protected server configuration.
2. All 256 captured static SQL statements prepare against Neon. SQLite annual
   suffixes, period patterns and case-insensitive matching have PostgreSQL
   equivalents. Financial fact and answer cache versions were advanced.
3. Both official Blueprint validators pass and Render server secrets are set.
4. Public submission and real model processing pass without ChatGPT sign-in.
   A different visitor receives 404 for another session's question. Foreign-origin
   writes, spoofed administrator access and anonymous worker access are rejected.
5. Azure connectivity, VM TLS, local ranges/authentication and a Render-to-VM
   authenticated PDF metadata check pass. A visitor-facing migrated Wipro PDF
   returns 206 with the requested byte range and a valid PDF signature.
6. Export the live data and originals, import into the destination, and verify
   counts, hashes, source links and owner/session mapping. Never import service
   tokens, OAuth credentials or stale active leases as ordinary application data.
   Completed using a short-lived authenticated bridge with page checksums and
   a final stable snapshot. The truncated table-row reader was not used to copy
   evidence. Login credentials and visitor histories were excluded.
7. The existing worker and collection timer use the Render origin. The worker
   reports `research-2.16`, model access ready, and no restarts during live checks.
8. A real Infosys agent answer completed two rounds and used three verified
   backend calculations: revenue growth, profit growth and margin change. Its
   answer contains four citations, six calculation references and no evidence
   gaps. A Wipro question also completed with cited financial figures.

Automatic AI interpretation remains paused. Public questions invoke the model
on demand; the hourly collection timer does not use an LLM. Prolonged idle,
multi-client stress and final responsive-browser inspection were not performed;
browser control became unavailable during the last inspection. The API and
production build checks above establish the verified deployment behavior.

Keep the original VM configuration and a rollback route to the existing Site
for operational recovery. The original
research service and collector sources are retained; their `render.conf` drop-ins
select the new URL and protected `render-config.json`. Removing those drop-ins
and restarting the services restores the original destination.

## Secrets

`DATABASE_URL` is the Neon TLS connection string. Store it only in protected
server configuration. Separate migration privileges from runtime privileges when
provisioning. Render and VM service credentials must never enter frontend code,
Git history, documentation or logs.
