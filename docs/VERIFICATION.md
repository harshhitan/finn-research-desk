# Verification — 29 October 2026

## Automated acceptance

- `node scripts/test-finance.mjs`: real corpus references and eight pathways, explicit foreign-company/price-prediction/missing-period abstention; current and previous fiscal-year selection; financial arithmetic; cash capex and net-debt reconciliations.
- Market calculations: exclude intraday bars before 15:30 IST; use prior valid completed session and adjusted closes when available; exclude current volume from 20-session baseline; handle short baseline, zero-volume gap and split.
- `node scripts/test-api.mjs`: health; rules persist and reject invalid values; saves are idempotent and isolated by session; cited research/history; exact time windows and empty results; missing evidence 404; cross-origin write rejected.
- TypeScript type checking and production Worker build.

## Browser checks

Verified in the in-app browser at default desktop width and 390/360-pixel viewport overrides:

- Overview, annual metrics and financial trend chart render from real company data.
- Market lens retrieved a genuine completed session from Yahoo, dated 28 October 2026 during this test; no seeded quote is used.
- At 360 px, page width stays within the viewport. Quarterly table scrolls inside its 307 px panel (table content 510+ px), preserving page width.
- Research pathway loads a sourced cash-conversion answer; evidence drawer resolves printed page 202 / PDF viewer page 103 and its original URL.
- A saved cash-flow passage survives browser reload and appears in Saved.
- A changed price threshold (4.5%) survives reload; restored to the default after the test.
- Briefing defaults to an honest empty last-24-hour window; selecting seven days shows the actual 27 October issuer listing announcement.
- Source library contains 12 research-source entries plus separately fetched issuer records. New issuer attachments remain excluded from the research corpus.

The deployable product is scoped to Reliance. These checks do not assert multi-company generalisation or complete four-quarter promise outcomes.
