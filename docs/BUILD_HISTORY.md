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
