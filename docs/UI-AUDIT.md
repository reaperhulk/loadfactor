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
