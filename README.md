# FINN — Indian portfolio monitoring and document research

FINN is a responsive web app with a 20-company NSE portfolio and an
independent research library that grows when a user prepares another company.

- `/`: completed-day market data, exchange announcements, persisted alerts and source health.
- `/research`: generic company preparation, indexed annual reports/calls, cited on-demand answers and financial comparisons.
- `/research/reliance`: the preserved original Reliance desk, curated data and charts.

Live app: https://finn-reliance-research-desk.anandharshitwork03.chatgpt.site/research

## Pull implementation

Six seed companies are prepared through one pipeline: RELIANCE, TCS, INFY,
HINDUNILVR, LT and NTPC. Additional verified companies use the same pipeline,
without company-specific application code. The library displays current coverage
and page-readability gaps for each registered issuer. Readiness
requires two current consecutive annual years and six recent quarterly calls.
Historical evidence stays searchable without inflating recent coverage.

The app discovers issuer/exchange originals, verifies identity/type/period,
hashes and converts PDFs, stages page-aware chunks, and publishes a versioned
D1 FTS5 index. R2 stores originals and conversion artifacts. Source filters,
missing evidence, extraction quality, job progress and historical originals are
inspectable. NSE suffix aliases reuse their issuer; another verified symbol with
the same ISIN reuses the existing document/history identity instead of increasing
the company count. Unknown ISINs are not invented or merged by name.

Ordinary internal functions provide coverage, corpus search, passage reading,
financial facts, comparisons and margin calculations. Contracts declare JSON
input/output schemas, permissions, bounds and side effects. Bounded latest-run
diagnostics retain duration/outcome without private question text. The controller resolves
companies and queues preparation. No MCP server, embeddings service or personal-PC
runtime is required. A separate outbound Python systemd worker runs on the VM.
It uses standard-library Python, Poppler and bounded selected-page Tesseract,
with one serial workload. Heavy layout models are omitted for this VM's capacity.

Research synthesis runs for a saved user question. Portfolio interpretations run
automatically when enabled, with important disclosures first. The owner enabled
model access and completed VM device sign-in. The restricted Codex transport disables shell,
web, apps, browser, computer and multi-agent tools, limits document filesystem
access, and denies model-requested tools/approvals. Answers require source quotes,
known passage IDs and supported numbers. Failed inference needs explicit retry.
New successful answers retain provider-reported token usage. Owner-scoped caches
include source versions, model and prompt/retrieval/validation contracts.

Financial extraction supports reported operating/investing/financing cash flow,
revenue from operations, profit for the period and profit before tax. Explicit
table columns, periods, INR units and accounting scope are required. Uncertain
bases remain candidates. Code computes compatible annual YoY, quarterly YoY,
QoQ, unit conversions and reported profit/operating-revenue margins with source
fact dependencies and formulas. Missing tables, mixed durations, scope conflicts
and unsupported inputs cause abstention; a narrative mention is not a verified
financial fact. This is a prototype with bounded parser support, not universal
accounting extraction or investment advice.

## Runtime

The research VM has 892 MiB RAM. The service uses a 256 MiB memory cap, 192 MiB
pressure limit, 128 MiB swap cap, one-CPU quota, serial conversion/inference and
available-memory guards. Observed full runs peaked around 196 MiB, with zero
automatic restarts and no OOM kills. The scheduled model worker is disabled and
the cloud monitoring automation is paused. The collection-only VM timer remains
enabled and does not invoke a model. On-demand work can finish after closing the
browser; it depends on the VM being running, not the personal computer.

See [operations and recovery](docs/PULL_OPERATIONS.md),
[portfolio implementation](docs/PORTFOLIO_PIPELINE.md) and
[portfolio upgrade status](docs/PORTFOLIO_UPGRADE.md).

## Local setup

Tested with Node 24 on Windows and Python 3.12 on Ubuntu. The document worker runs
on Linux; its resource limits are not a Windows runtime.

```powershell
npm run install:ci
npm run build
```

For a **fresh** local database, apply the generated migrations once in filename
order. Do not replay already-applied SQL against an existing preview database.

```powershell
Get-ChildItem -LiteralPath drizzle -Filter *.sql | Sort-Object Name | ForEach-Object {
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Local migration failed" }
}
npm run dev -- --hostname 127.0.0.1 --port 5173
```

Use the printed local URL. Local preview has separate D1/R2 state and does not
inherit production documents or authentication. No model API key belongs in the
frontend or repository. Hosting identity and DB/BUCKET bindings are declared in
`.openai/hosting.json`; production secrets stay in Sites/VM protected configuration.

## Build checks

```powershell
npm run typecheck
npm run build
```

Test suites, diagnostic probes and temporary verification artifacts were removed
from this source tree for the GitHub handoff. Runtime validation, citation checks,
source verification and financial calculation guards remain in application code.

## Hosting

This same checkout supports the existing Cloudflare deployment and a prepared
Render Node server. For Render, use `npm run build:render` and
`npm run start:render`, with the server environment in `.env.example`.
Render uses Neon PostgreSQL and authenticated VM document storage. Its signed
visitor sessions allow public AI questions without ChatGPT sign-in.
The Render service is live at https://finn-research-desk.onrender.com. Data
transfer, VM public HTTPS connectivity, worker cutover and live AI verification
remain. See `docs/RENDER_NEON_MIGRATION.md`.

## Research API

Visitor research routes require an identity and same-origin writes. The existing
Site supplies its login identity; the Render server supplies a signed anonymous
visitor session. Administrative and worker endpoints require separate credentials.

| Route | Purpose |
| --- | --- |
| `GET /api/research` | Library counts, worker availability and internal tool names |
| `GET /api/research/companies/search?q=...` | Existing or verified new company lookup |
| `POST /api/research/companies/prepare` | Create or reuse a durable preparation job |
| `GET /api/research/companies/{ticker}` | Current documents, periods, readiness, progress and failures |
| `POST /api/research/search` | Company/year/type-scoped evidence retrieval without a model |
| `POST /api/research/questions` | Cache reuse or a saved on-demand research request |
| `GET /api/research/questions/{id}` | Owner-bound request/answer status |
| `POST /api/research/questions/{id}/retry` | Explicit retry of a failed request |
| `GET /api/research/history?ticker=...` | Owner-bound saved questions/answers |
| `POST /api/research/facts` | Source-versioned financial totals and validation gaps |
| `POST /api/research/facts/compare` | Compatible annual/quarterly changes |
| `POST /api/research/facts/margin` | Verified profit/operating-revenue ratio comparison |
| `GET /api/research/documents/{id}/original?version=...` | Authenticated original PDF with ranges/HEAD |

The service-authenticated `/api/research/worker/*` protocol handles only bounded
research jobs/artifacts and diagnostics. It cannot read visitor question history
through the original-document verification exception. The old deterministic
Reliance answer routes are retained at `/api/legacy-research` and
`/api/legacy-research/history`.
