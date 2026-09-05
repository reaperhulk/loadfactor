# Load Factor improvement programme

Authorized on 2026-09-05: implement the complete review and push incremental,
validated commits to main. Preserve quarterly, deterministic, headless play.

## Delivery checklist

- [x] Shared, seat-aware forecasts; route contribution/company profit reconciliation;
      accurate launch and scheduling previews; objective-aware results everywhere.
- [x] Rules/content versions for careers and multiplayer; legacy recovery;
      visible storage failures; export/import and hot-seat restoration.
- [x] Three-quarter introduction, actionable management brief, compare-and-commit
      planning, clearer reports and compact default route tables.
- [x] Airline-era visual identity, aircraft silhouettes/cards, responsive map and
      dossiers, explicit overlay controls, accessible colors/focus/text/motion.
- [x] Era music, ambience and effects with separate volumes, variations,
      transitions, priorities and hidden-tab suspension.
- [x] Passenger segments and a shared direct/connecting itinerary market;
      alternative hubs, coordination and feeder-route effects.
- [x] Fleet commonality, planned maintenance, reserve capacity, replacement
      forecasts and simple multi-route utilization.
- [x] Sustained rival campaigns, announced multi-quarter opportunities,
      short scenarios and meaningful objective qualification.
- [x] Quarter-boundary undo, batched replay, browser rendering/animation budgets,
      startup budgets enforced in CI, Chromium and WebKit coverage.
- [ ] Broader held-out balance evaluation and final user-flow verification.

## Verification

Run `npm run ci` before each code commit. Engine changes require meaningful
determinism/accounting/behavior tests and intentional golden updates. Preserve
old rules when loading old command logs; never silently reinterpret a career.
Profile browser interaction and long careers before speculative optimization.
Track completed commits and measured outcomes below.

## Progress

Baseline: b057fdc; 185 unit tests; current CI green. Review measured one 80-quarter
career at 767 ms, resolution p95 11.5 ms and replay 469 ms in the review runtime.
Ten additional Jet Age seeds yielded eight wins and two mid-career bankruptcies.

Stage 1: shared forecasts/accounting, schedule optimization, seat-aware reports
and scenario ranking. All 188 unit tests, lint, types, build and bundle budget
passed; legacy golden careers unchanged. `npm run ci` reached browser tests but
this runtime cannot download Playwright browsers (CDN timeouts). Hosted CI will
run those tests for each pushed stage.

Stage 1 pushed as 1435497. Stage 2 adds explicit rules/content identity, objective
challenge/replay/fame displays, hot-seat exports and active-seat restoration,
visible quota errors with downloadable recovery, persistent outgoing duel links,
batched multiplayer replay, and quarter-boundary undo. Four recovery tests added.

Stage 2 pushed as 2130b94; all 192 unit tests and 60 hosted Chromium tests passed.
Stage 3 implements rules 2: conserved segmented itinerary competition, alternate
hubs, feeder attribution, coordinated banks, family costs, preventive maintenance,
reserves, shared rotations, replacement delivery plans, sustained rival campaigns,
addressed/calendar offers, and four short mandates. Legacy rules/hashes retained.
New golden fixtures are intentional; the original fixtures remain in
`fixtures/legacy-v1-goldens.json`. Balance distributions now include naive, greedy
and cautious policies; the hub policy explicitly values connecting spokes.

Stage 3 verification: 217 tests passed; lint/types/build passed; eager bundle
168 KiB gzip against 190 KiB budget. The six untouched release seeds across all
nine scenarios and three policies produced 162 careers: all 108 competent
careers reached their deadlines, 84 won, and no naive career won. Results are
checked in as `fixtures/balance-v2-report.json`; the independent CI seed matrix
also passes. Local browser tests still cannot launch the unavailable executable;
the hosted Chromium gate validates the pushed build.

Stage 3 hosted browser results: 57/60 passed. Fixed two offer-card stacking
failures on mobile and a legacy challenge target hidden by the new default
metric. Stage 4 adds original five-era generative music, three audio buses,
visibility suspension, text/motion/traffic preferences, aircraft illustrations,
navy operations screens and paper reports, responsive dossiers, a three-quarter
introduction, actionable brief, an atomic planning workbench, lazy full-network
fare/service/closure comparisons, public aircraft/airport calendar, and two new
milestones. Five new end-to-end flows cover these controls and recovery.

Stage 4 pushed as 21de6d1. The live layout review verified the hub scenario,
quarter report and working controls; it found and fixed an overlapping map
selector, initial scroll position, and compact totals alignment. Local checks:
217 tests passed; eager bundle 176 KiB gzip. Hosted browser validation ongoing.

Stage 5 adds desktop/mobile WebKit coverage, enforces the 190 KiB startup gate
in hosted CI, deploys the exact checked artifact only after all browser tests,
and replaces unbounded stale HTML caching with fresh documents and a bounded
48-entry offline shell. Offline contract tests preserve other same-origin apps.
Schedule delegation now rejects a batch that would lower full-network profit.
Hedge-aware fuel exposure uses shared forecasts; idle recommendations preserve
standby aircraft; city market comparisons use the active multiplayer seat.

Profiling: 20/40/65-quarter Jet Age states held 13/19/25 routes and 14/22/34
frames. Full forecast p95 was 2.5/3.6/2.6 ms; schedule search 15/11/10 ms before
the two full-network safety evaluations. The repeatable command is
`npx vite-node tools/profile-planning.ts`. These are local measurements, not a
promise for every device. Simulation and replay timing remain gated in tests.

Final UI consistency sweep: route/market capacity honors current groundings and
standby substitutions; map traffic includes secondary rotations; fleet utilization
sums both legs of shared work; maintenance totals share the commonality factor.
These are display corrections. The simulation's existing rounding is unchanged.
