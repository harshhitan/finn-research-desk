# FINN — Reliance research desk

A responsive, installable web application for understanding Reliance Industries. The product uses a restrained financial-desk interface: comparative tables, clearly stated accounting bases, concise research and inspectable evidence.

## Implemented

- Company overview and annual revenue/EBITDA trends.
- Annual and quarterly consolidated statements with deterministic TypeScript calculations, reported QoQ/YoY comparisons, and cash conversion.
- Live public Yahoo EOD adapter, completed-session filtering, prior-20-session volume baseline and split safeguards; provider failures preserve the last successful data.
- Reliance issuer announcements, stable URL hashes, persistent caching, title-based classification, materiality ordering, routine-item collapse, date/category filters and original filing links.
- Eight research pathways based on the assignment reference: business, financials, cash quality, balance sheet, management guidance, risks/governance, trajectory and bull/bear interpretations.
- Server-side passage retrieval over a verified Reliance annual-report/transcript corpus. Research returns up to three sourced observations, numerical calculations where supported, and explicit evidence gaps.
- Source drawer with printed/PDF page distinctions, original URLs and company-report definitions; glossary, saved source passages/documents and persisted research history.
- In-app alert preferences and durable, deduplicated alert triggers. Observation polling runs while the app is open.
- Responsive desktop and phone layouts, bottom navigation, accessible dialog dismissal/focus containment and a web-app manifest.

## Architecture

React/TypeScript through Vinext, deployed as one Cloudflare Worker using Sites. D1 stores per-user/session preferences, saved records, research history, provider caches and alerts. The verified research index is a versioned source file in `data/reliance.json`.

This replaces the proposed separate FastAPI/Supabase deployment for this first single-company release. One deployable application gives a usable backend without requiring the user to configure model or database credentials. Research is **extractive and deterministic**, not an undisclosed LLM simulation. It does not need a model key. Source and accounting limitations are explicit in the UI and in [data/SOURCE_NOTES.md](./data/SOURCE_NOTES.md).

## Local setup

Requires Node >=22.13, npm, Git and tar. From this directory:

```powershell
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_common_hydra.sql
npm run dev -- --hostname 127.0.0.1 --port 5173
```

Open the URL printed by the dev server. Apply the migration once to a fresh local database; do not replay an already applied schema. Dev and built preview share `.wrangler/state`. To preview a completed build, use `npm start` instead of `npm run dev`.

No model API key is required. Optional `FINN_TEST_URL` changes the API test origin; it defaults to `http://127.0.0.1:5173`. Private hosting supplies a signed-in visitor ID. Local anonymous use gets an HttpOnly session cookie; clearing that cookie creates a different notebook. Database files and local environment files are ignored.

## Verification

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-finance.mjs
node scripts/test-api.mjs
```

The API test needs a running, migrated preview. It uses its own temporary session, checks persisted writes and restores its settings. Financial checks cover evidence integrity, allowed-document isolation, fiscal-period gaps, eight pathways, growth arithmetic, FCF, net debt, intraday exclusion, adjusted closes, splits and volume baselines. See [docs/VERIFICATION.md](./docs/VERIFICATION.md) for browser checks.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Database and research mode health |
| `GET /api/bootstrap` | Corpus, saved items, rules, cached filings and alerts |
| `GET /api/market` | Market + issuer refresh subject to cache; evaluate new observations |
| `GET /api/briefing?from=&to=` | Windowed records with source coverage |
| `POST /api/research` | `{question, ticker:"RELIANCE", topic?}` sourced research |
| `GET /api/research/history` | Visitor's last 20 research runs |
| `GET /api/evidence/{id}` | Source passage and parent document |
| `GET/POST /api/saved` | Read/toggle source or filing saves |
| `GET/PUT /api/alert-rules` | Read/validate/persist preferences |
| `POST /api/refresh` | Bounded manual refresh, one-minute cooldown |

Writes reject mismatched Origin headers. SQL values use bound parameters, records are scoped to signed-in ID/session, research input is bounded and rate limited, and retrieval does not execute document instructions.

## Monitoring and freshness

UI polling: 60 seconds while open. Server-side public-price cache: one hour. Issuer-announcement cache: ten minutes. These are best-effort checks, not exchange streaming or background device notifications. A manual source check bypasses normal provider cache age, subject to cooldown. Price-rule changes apply only to observations fetched after the change. Announcement rules apply to newly observed material records within the last day; issuer dates have day precision.

Announcement retrieval covers the latest issuer page, retaining previously observed records (up to 100). It does not claim exhaustive NSE/BSE coverage. New attachments are linked and classified by title, not silently treated as indexed research evidence. Research remains restricted to allowed annual reports and transcripts.

## Scope and limitations

- This release deliberately covers one company, Reliance; other tickers are explicitly rejected.
- The research corpus has 12 source entries and 22 evidence records, including sections from the same annual report. It is not 12 separate annual reports.
- FY2024–FY2026 annual highlights are verified; fuller statement details cover FY2025/FY2026. Latest verified research quarter is Q1 FY2027, ended June 2026. This does not assert that no later filing exists.
- Four-quarter promise outcomes are not established. Actual forward statements show pending/non-comparable/missing states rather than invented scores.
- Source extracts are concise factual indexes/paraphrases. Open the report for complete notes and auditor matters.
- No trades, holdings/P&L, broker connections, email alerts, native binary or background push delivery.

## Deployment and source

`.openai/hosting.json` retains the Sites identity and `DB` binding. Use the Sites source workflow to commit/push, build/package the exact revision and deploy privately. D1 migrations are applied by the host before upload. Do not put secrets into the source manifest. The source helper initializes and syncs the managed source repository; the final deployment is tied to its returned commit SHA.

Build decisions and history pointers: [docs/BUILD_HISTORY.md](./docs/BUILD_HISTORY.md).

