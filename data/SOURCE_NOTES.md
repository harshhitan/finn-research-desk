# Reliance source verification

Verified on 29 October 2026 using official company documents. `reliance-research.json` is a compact factual index and paraphrased evidence corpus, not a complete extraction of all documents.

## Pull corpus

- FY2025–26 Integrated Annual Report: https://www.ril.com/ar2025-26/RIL_IAR%202026.pdf
- Annual online report: https://www.ril.com/ar2025-26/index.html
- Q1 FY2027 call, 17 July 2026: https://www.ril.com/investors/events-presentations#webcast-sec
- Q4 FY2026 call, 24 April 2026: https://www.ril.com/sites/default/files/2026-04/24042026_RIL_Media_Analyst_Call_Transcript_Q4_FY2026.pdf
- Q3 FY2026 call, 16 January 2026: https://www.ril.com/sites/default/files/2026-01/RIL_Media_Analyst_Call_Transcript_Q3_FY2026.pdf

Online annual-report section URLs are separately identified in `documents`. They are part of the annual-report corpus. The events page also embeds an AGM transcript: the indexed call records refer specifically to the Q1 FY2027 analyst presentation.

## Push-only results source

https://rilstaticasset.akamaized.net/sites/default/files/2026-07/Media_Release_RIL_Q1_FY2026-27_Financial_and_Operational_Performance.pdf

The Q1 FY2027 release contains current quarter, preceding quarter, same quarter last year, and FY2026 comparisons. It is allowed for the results card, not silently used to expand the pull corpus.

## Accounting and presentation checks

1. Annual gross revenue includes GST; revenue from operations excludes it. Keep labels explicit.
2. PAT in headline numbers is profit including associates/JVs and before non-controlling-interest allocation. Owners' profit differs.
3. FY2026 EBITDA includes a listed-investment sale gain. Do not describe all annual growth as operating growth.
4. Q1 FY2027 recurring YoY EBITDA is +10.1%, but reported YoY EBITDA is -6.8%. The comparative recurring EBITDA removes an 8,924 crore listed-investment gain from Q1 FY2026. Profit has the same adjustment; recurring +6.1%, reported -24.6%.
5. The Q1 FY2026 reported EBITDA, PBT and profit in JSON are derived from the recurring comparison plus the disclosed gain. The raw recurring values are stored separately. Use a consistent comparison basis.
6. Group liquidity of 249,704 crore at March 2026 is cash plus marketable securities, not cash alone. Cash equivalents alone are 145,977 crore.
7. Company-reported capex 144,271 crore differs from cash expenditure 122,916 crore in the cash-flow statement. FINN-derived FCF of 69,197 crore uses CFO less the latter; it includes cash spending on spectrum and intangible assets.
8. Segment revenue contains inter-segment activity; it is not a pie of consolidated revenue. Digital Services segment and Jio Platforms are different scopes.
9. Retail segment growth and margin comparisons use net revenue for the EBITDA margin denominator.
10. Financial-statement approval date is known (24 April 2026); annual-report publication date was not independently verified and remains null.
11. The report PDF has 147 two-page spreads. `pdfPage` is one-based viewer page; `page` contains printed report labels. Example: consolidated cash flow printed page 202 appears on viewer page 103.
12. The consolidated audit opinion is unmodified, but this does not imply there are no key audit matters or commercial risks. Related-party management disclosures are attributed as such.
13. Four-quarter promise coverage has not been established. Keep missing-evidence and pending states. The 2035 carbon goal is not due in a recent quarter.
14. The latest verified report in this snapshot is Q1 FY2027 ended June 2026. This does not establish that no later result exists, nor does it establish a live quote.

## Validation

All JSON document/evidence references should resolve. Financial units are INR crore unless explicitly specified. No current market price, valuation ratio, market capitalisation or volume is fabricated.
