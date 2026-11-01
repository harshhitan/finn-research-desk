# Pull research build status

1 November 2026. The full implementation goal remains active pending the final
source review, current-contract cache demonstration and requirement audit.

## Live product

The owner-private Site is
https://finn-reliance-research-desk.anandharshitwork03.chatgpt.site/research.
The library contains RELIANCE, TCS, INFY, HINDUNILVR, LT, NTPC and COFORGE.
Coforge was added through the new-company workflow and its saved question resumed
without an open browser. Registered, ready and partial counts remain separate.
The original Reliance desk and historical source versions remain available.

Documents are discovered from issuer and exchange sources, converted to page-aware
text and indexed in D1 FTS5. R2 holds PDFs and conversion artifacts. The separate
VM worker runs outbound, with durable jobs, leases, source-versioned staging and
bounded retries. One serial workload uses Poppler and selected-page Tesseract.
No MCP server, heavy local model or personal-PC runtime is required.

The owner approved on-demand answers and completed device sign-in. Actual cited
answers passed validation for Reliance, TCS, Infosys, HUL and Coforge. Quotes,
amounts, document versions and company scope are checked before saving. Failed
inference requires explicit retry. Generation receives prompt research-3 and a
bounded output schema; documents cannot grant tool or approval permissions.
The old scheduled model worker is disabled and cloud monitoring is paused.
The collection-only timer remains enabled.

The research service has a 256 MiB memory limit, 192 MiB pressure limit,
128 MiB swap cap, one-CPU quota, serial inference/conversion and memory guards.
Observed model/ingestion peaks stayed near 195 MiB, with no automatic restarts.
The installed worker is research-2.9. Its 24 Linux tests and four shared model
transport tests pass. The research protocol suite and TypeScript checks pass.

## Source quality and financial calculations

Readiness requires two consecutive current annual-report years, six distinct
recent call periods and readable sources. Historical evidence remains indexed.
Current-period readiness ages on read. NTPC's stale call coverage was repaired:
its latest call is Q4 FY2026 with seven recent periods. The issuer's browser
challenge is reported with backoff; independent exchange-filed copies supplied
newer transcripts without bypassing verification. Genuine unreadable pages keep
TCS, Infosys, L&T and Coforge partial.

The internal registry includes coverage, search, passage reading, financial facts
and deterministic comparison. Financial-table extraction supports net operating, investing and financing cash
flows, revenue from operations, profit for the period and profit before tax.
Annual and quarterly tables require explicit reporting columns, INR units and
accounting scope. An observed aligned Note column can be separated from amounts;
an arbitrary third number is rejected. Forecast and mixed-duration tables are
excluded. Uncertain accounting bases remain durable candidates, excluded from
calculations. Validated totals retain original values/units and source provenance.

The comparison engine computes annual YoY, quarterly YoY, QoQ, unit conversion
and reported profit/operating-revenue margins using exact decimal arithmetic.
It checks compatible company, metric, period, currency, duration, scope and basis.
Margins require profit and revenue from the same statement version; source
revisions invalidate cached figures. Formula outputs retain fact dependencies.
Percentage growth from a nonpositive base is withheld. Unsupported layouts and
missing quarter data return explicit gaps.

The deployed cash calculator was visually checked for TCS FY2025 to FY2026:
INR 48,908 to 52,094 crore; increase 3,186 crore, 6.5142%. The extended income and
margin implementation passes unit/protocol tests and actual TCS/Infosys source
passage checks; publication and live UI verification are pending. HUL's hyphenated
quarter-ended cover is now parsed; cached unknown periods are reverified. Its
extra unverified source was reconciled back to seven verified call periods.

## Final review in progress

The 30-case retrieval manifest records full public-source excerpts, IDs, pages,
versions and scope checks. All company/type/year checks passed and three missing
2099 cases were empty. Nonempty results are not semantic acceptance. The broad
HUL segment note is now found. Further review identified an Infosys cash-total
ranking gap and an impairment note outranking Coforge's business note; retrieval
fts-neighbours-7 addresses these observed cases and invalidates older caches.
The current-contract TCS numerical answer succeeded on an explicit retry after a
transport interruption. Repeating it displayed SAVED ANSWER. Final source-review
writeup, extended financial UI checks and the completion audit remain.

Authoritative live verification and remaining scope are recorded outside this
checkout at ../docs/PULL_RESEARCH_VERIFICATION.md. The full accepted specification
is ../docs/PULL_RESEARCH_IMPLEMENTATION.md; do not infer full completion from this
status document or the presence of seven indexed companies.
