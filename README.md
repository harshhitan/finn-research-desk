# FINN — Indian portfolio monitoring and document research

FINN is a private, responsive web app with a 20-company NSE portfolio and an
independent research library that grows when a user prepares another company.

- `/`: completed-day market data, exchange announcements, persisted alerts and source health.
- `/research`: generic company preparation, indexed annual reports/calls, cited on-demand answers and financial comparisons.
- `/research/reliance`: the preserved original Reliance desk, curated data and charts.

Live app: https://finn-reliance-research-desk.anandharshitwork03.chatgpt.site/research

## Pull implementation

Six seed companies are prepared through one pipeline: RELIANCE, TCS, INFY,
HINDUNILVR, LT and NTPC. COFORGE was added through actual company search with no
company-specific code change. The library has seven registered issuers; three
are ready and four remain partial for real page-readability gaps. Readiness
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

Model synthesis runs only for a saved user question. The owner explicitly enabled
it and completed VM device sign-in. The restricted Codex transport disables shell,
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

## Runtime and verification

The research VM has 892 MiB RAM. The service uses a 256 MiB memory cap, 192 MiB
pressure limit, 128 MiB swap cap, one-CPU quota, serial conversion/inference and
available-memory guards. Observed full runs peaked around 196 MiB, with zero
automatic restarts and no OOM kills. The scheduled model worker is disabled and
the cloud monitoring automation is paused. The collection-only VM timer remains
enabled and does not invoke a model. On-demand work can finish after closing the
browser; it depends on the VM being running, not the personal computer.

Real cited answers were accepted for Reliance, TCS, Infosys, HUL and Coforge.
The current-contract TCS numerical question repeated as SAVED ANSWER. A fresh
Infosys answer persisted actual provider usage. The 30-case source review found
no company/type/year violations: 21 supported/qualified cases, six partial cases
with explicit limitations and three expected missing-year cases. Retrieval
support is not a guarantee that every generated interpretation is correct.

See [build status](docs/PULL_BUILD_STATUS.md),
[operations and recovery](docs/PULL_OPERATIONS.md),
[source-review ledger](docs/PULL_RETRIEVAL_REVIEW.json),
[portfolio implementation](docs/PORTFOLIO_PIPELINE.md) and
[build history](docs/BUILD_HISTORY.md).

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

## Checks

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-research.mjs
python scripts/test-private-codex-worker.py -q
npm test
npm run test:portfolio
npm run test:results
npm run test:results-view
```

On the Linux worker: `python3 -B test_worker.py -q` (24 tests). The six shared
transport tests use mocked protocol events, no credentials or inference. The
research suite uses an isolated SQLite database and checks real migrations,
authorization, versioned publication, recovery, source filters, answer validation,
cache invalidation, aliases, financial extraction and exact calculations.

## Research API

All visitor research routes require sign-in and same-origin writes.

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
