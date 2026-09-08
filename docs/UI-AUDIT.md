# UI audit — September 2026

Audited the published 9b7a55c build and source, including initial setup, the first
route, Desk guidance, route/fleet comparisons, inspectors, settings and review.
The existing viewport-owned workspace and retained list state are good foundations.

## Five priorities

1. **First-flight clarity.** The starter career sat below customization, a daily
   challenge and four mandates. The initial empty map did not direct new players
   to its existing first-market comparisons. Add a prominent starter action and
   contextual guidance; wrap scenario chips and correct setup labels.
2. **Responsive usability.** Cover 320px phones, touch tablets and short landscape
   windows. Improve touch targets, safe areas and the amount of usable content.
3. **Keyboard and accessibility.** Global shortcuts interfere with disclosures;
   dialog focus omits summaries. Make navigation and inspector dismissal predictable,
   name icon controls and expose table sort direction.
4. **Route discovery and comparison.** Search accepts airport codes only, empty
   results provide no recovery, and dense tables lose context while scrolling.
   Support city names, result counts, reset actions and persistent comparison labels.
5. **Review ergonomics.** Long quarter forecasts and route-launch dialogs push
   primary actions below the fold. Keep actions and dismissal reachable while
   scrolling, without obscuring content or changing planning semantics.

Implementation and verification are recorded with each commit. Engine rules,
forecasts and saved career formats are not changed by this audit.

## Implemented

- A first-career action above customization and a first-flight prompt on the map;
  wrapped scenario chips, valid form labels, and accurate handbook goal wording.
- 44px touch targets across phones and touch tablets; notch safe areas, scalable
  navigation widths, and a compact rail for short landscape screens. Settings
  keep their heading outside the scroll area and stack selects to accommodate
  enlarged text in Safari and on phones.
- Disclosures retain native Space behavior. Dialogs include summaries in their
  focus cycle, keep the covered workspace inert, handle initial Shift+Tab, and
  restore focus. Inspectors handle Escape; route navigation retains button focus.
  Inbox has an explicit accessible name and sortable headings expose direction.
  Native modal focus handling is paired with explicit career-results precedence,
  so a delayed final-quarter report cannot cover the New game action.
- Route and aircraft search accepts city names; counts and reset controls explain
  empty results. Expanded route metrics retain the route column and header while
  scrolling, with keyboard scrolling and clear accounting labels.
- Quarter review, route launch and reports have independent scrolling content,
  stable headings and persistent actions. The phone plan tray uses less width.

## Verification

`npm run check` passes all 290 unit tests, lint, TypeScript and the existing 190 KiB
startup / 95 KiB map budgets. The new `e2e/ui-audit.spec.ts` runs in Chromium,
desktop WebKit and mobile WebKit alongside the existing responsive and mature
career suites. It covers 320px phones, 667×375 and 844×390 landscape, tablets,
1366×768 desktop, 125% text, first-route launch, city searches, empty-result
recovery, pinned columns, dialog focus and visible review actions. Screenshots
are attached to the CI browser report for visual inspection.

Local browser binaries could not be downloaded in this workspace. Browser
validation therefore runs in three GitHub CI shards, all of which gate the Pages
deployment. Screenshot captures finish entrance animations before capture.
