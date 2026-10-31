# AI build history and decisions

This implementation was developed in the FINN Codex chat, ID `01a186c6-ddd3-7212-a890-cfa43772a726`, on 29 October 2026. Preserve/export the actual chat before assignment submission; this file is a pointer and decision record, not a substitute for that history.

The original assignment and reference were read completely from their shared Drive folder. Main brief: https://drive.google.com/file/d/1j8OGRuQZxcH_H1jTXpY0GNw6BAHTKneB/view . Reference: https://drive.google.com/file/d/1g1YGp86o3iZgnQgLa835v_PjkfsZT6LE/view .

- Scope: first release is a complete single-company workspace, as directed by the user. The broader 15–20-company plan remains a later expansion.
- Product: company/financial-table navigation and evidence access draw on established patterns seen on Screener's Reliance page; no generic chatbot landing screen. Screener is a design/discovery reference, not the pull-research evidence corpus. https://www.screener.in/company/RELIANCE/consolidated/
- Education: plain definitions and statement-based analysis follow the supplied glossary, with annual-report research also checked against Zerodha's primary educational materials. https://zerodha.com/varsity/modules/
- Hosting: Sites + React/TypeScript + Worker + D1 keeps frontend and functioning backend in one privately deployable application.
- Research: a verified primary-source index plus deterministic extraction and calculations works without credentials. LLM synthesis can be introduced later after evaluation; none is claimed here.
- Financial presentation: distinguish gross/net revenue, PAT before/after associates and owners, reported/recurring growth, cash/reported capex and net debt/liquidity basket. No segment revenue pie because segment revenue is not additive after eliminations.
- Freshness: separate research coverage, issuer observations, and market sessions. Retain last successful provider data and disclose partial coverage.
- Monitoring: in-app only while open, with persisted thresholds and triggers. No undisclosed background notification channel.
- Source evidence: a bounded research subagent verified the primary documents and produced the factual corpus; the main agent integrated and checked those references and financial invariants.

No credentials are embedded in authored source or this history. Hosting repository credentials are passed to the Sites helper through hidden stdin.
# Results-comparison completion — 30 October 2026

- Added primary-period and reporting-entity evidence to analysis schema v2,
  deterministic QoQ/YoY comparison and a source-inspectable results drawer.
- Comparisons retain gaps, isolate subsidiaries/bases/definitions, expose exact
  INR conversions and withhold conflicting figures or nonpositive denominators.
- Added real SQLite API checks for owner isolation and changed-document
  invalidation, result-engine tests and server-rendered component tests.
- Verified the completed scheduled cloud run and its authenticated source access:
  20 quote series, 168 filings, no source errors and a clear queue at 17:37:51 IST.
- The browser verification tool timed out during this phase. API/type/SSR tests
  pass; the new results card's browser layout is not yet verified. Earlier 390 px
  verification covers the portfolio shell, not this new card.
- Hosted ChatGPT inference still awaits approved registration. No synthetic
  comparison figures or mocked model output were deployed as real financial data.

# Portfolio monitoring expansion — 30 October 2026

- Expanded from a single-company landing view to a 20-company NSE monitoring
  workspace; retained the original source-grounded desk at `/research`.
- Verified ticker/ISIN identity using NSE's live equity directory and exercised
  NSE historical announcements, exchange RSS and public Yahoo EOD providers.
- Added durable collection state, leases/retries, filing and alert idempotency,
  source coverage, digest windows, preferences and a protected unattended writer.
- Built FINN's own ChatGPT authorization/inference adapter without Hermes.
  Hosted model activation remains blocked by missing approved registration,
  confirmed by the owner. No existing personal Codex credentials were accessed.
- Local acceptance: 20 EOD series, 168 persisted filings, real NSE PDF text/hash
  and cache, exact time windows and preference persistence. Protocol tests cover
  callback replay, wrong-user callbacks, PKCE, JWT signature/claims, token refresh,
  encryption, disconnect, unsupported claims and model-stream completion.
- Mobile verification at 390 px: 20 company cards and no document-wide horizontal
  overflow. Published and scheduled-run verification is recorded separately.


## Personal Codex worker — 31 October 2026

The owner clarified that FINN is private and for personal use. Installed official Codex CLI 0.166.0 on the Azure VM; the owner completed device authentication. Verified `Logged in using ChatGPT`, an actual completed inference returning FINN_CODEX_CONNECTION_OK, and the client model catalog (gpt-6.1-sol default). Added an independent outbound Python/stdio worker and a lease-protected, owner-bound Site queue. The existing hosted OAuth adapter stays disabled. Protocol tests cover duplicate jobs, wrong-owner requests, service authentication, lease recovery/replay, fabricated source quotes, cache reuse and offline status. Results and presentation regressions pass. VM service-token installation and full production filing validation must be verified separately.

Production validation: the private VM worker completed NTPC filing nse-106836058 through gpt-6.1-sol. The published app displayed the stored interpretation and two exact supporting quotations on PDF page 1, with the original two-page PDF hash ff043c41243b1ce7bbbf360d51520c3fd30a8fd1b2a7b822ed599c88253fc856. The filing reports capacity, not Revenue/EBITDA/PBT/PAT, and the analysis leaves financial metrics empty. Codex 0.166 requires the named permissions profile instead of legacy readOnly.access; selected a minimal read-only FINN profile with network disabled. Disabled instruction-file discovery because its sandbox helper cannot initialize a loopback network interface on this VM. A full structured turn then succeeded with the restricted profile. No sandbox bypass or broader network access was enabled. The worker is an enabled, hardened systemd service.

## Reliance 30 October press release validation fix — 31 October 2026

Reproduced the live rejection of filing nse-106837406 (23-page exchange PDF, SHA-256 587a23505889ee73d948cdc26c311c80cbf93ac406cbd438f016ea2b82f59aad). Two valid accounting descriptions were 130 and 162 characters, exceeding an arbitrary 120-character limit; increased the bounded limit to 512 so accounting adjustments remain intact. The primary-period heading uses 30TH SEPTEMBER, 2026; added correctly suffixed ordinal day parsing for named dates while retaining exact date/year validation. Replayed the original rejected model payload through the real validator: two claims and all 34 financial observations pass, with the full basis strings preserved. Source quotes, values, currencies, entity/scope and comparison rules are unchanged. Regression checks still reject unsupported numbers, wrong dates, invalid suffixes and overlong accounting descriptions. Worker errors now distinguish safe FINN validation failures from provider/transport failures, retaining one protected rejected candidate for diagnosis.
