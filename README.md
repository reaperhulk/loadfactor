# Load Factor

An airline business simulation inspired by Aerobiz Supersonic. Build a connected
network, choose your fleet, compete for passengers and keep the treasury healthy
through fuel shocks, recessions and changing aviation eras.

[Play Load Factor](https://langui.sh/loadfactor/).

The simulation is deterministic and runs without a browser. A career records its
scenario, seed, rules/content versions and commands. Saves, replays, multiplayer
turn links, bot playtesting and golden tests all use that same record. Existing
unversioned careers keep their original rules; new careers use rules 4. Rules 1, 2 and 3 retain their original deterministic behavior. Rules-2 solo careers can opt into improved operations in Fleet policy.

## Playing

```bash
npm ci
npm run dev     # http://localhost:5173
```

- **Found an airline.** Choose a name, livery and home airport. Play solo, pass
  the device among two to four players, or exchange turn links in a duel.
- **Learn the first three quarters.** The operations desk proposes a first
  market, flags financial or fleet problems, and points to decisions you can make.
- **Understand the result.** Approved forecasts survive save/load. Quarterly reports explain revenue and cost differences, and route analysis identifies capacity, season, startup and service issues with changes to preview.
- **Plan before committing.** Compare aircraft and schedules when opening a
  route. The Routes workbench stages multiple fare, service and frequency changes,
  previews full company profit and cash, and commits them as one undoable action.
  A shared plan tray carries drafts across the Desk, map, adviser, route inspector
  and expansion tools; invalid batches never apply partially.
  Its stress test adds 20% to the fuel index and reduces the demand index by 10%.
  The Network adviser proposes individual improvements, respects locked fares, service and frequencies, and recalculates combined effects before one undoable apply. Expansion comparisons rank feasible launches by company profit or the scenario objective, include connecting traffic, and carry the selected aircraft and schedule into launch review.
- **Plan around commitments.** Company → Outlook compares buying, leasing,
  replacement or waiting over four/eight quarters, with known deliveries, checks,
  debt, contract expiry and a headwind case. Advice supports the scenario goal,
  profit, passenger growth, connections, efficiency or resilience and a cash floor.
- **See the network working.** Route and city inspectors expose passenger paths,
  competing carriers, constrained legs and uncarried potential demand. Highlight
  a journey on the map; rules-4 careers also retain actual last-quarter paths.
  Fleet → Operations shows a 13-week calendar and previews check timing,
  standby bases and shared rotations before staging the change.
- **Compete for passengers.** Business, leisure and budget passengers weigh
  price, service and schedule differently. Direct flights and viable one-stop
  itineraries compete for the same origin/destination demand across airlines.
  Route dossiers compare fare, service and closure choices with connecting
  traffic included. Passenger totals count boardings; a connection uses two legs.
- **Build a useful hub.** Every route must touch your existing network. Airport
  slots are rented, with a queue and published expansion programmes. Coordinated
  arrival banks improve connections but add costs and depend on reliability.
- **Manage the metal.** Order, lease or buy used aircraft; choose cabins, share
  an airframe between two routes, keep standby cover and book preventive
  maintenance. Repairs now remove hours or days, with reserve hours and compatible standby aircraft covering disrupted flights. Book 7–10-day checks, choose reserve hours and optional paid recovery in Fleet policy and aircraft details. Fleet commonality changes upkeep. Replacement plans preview costs
  and keep the old aircraft working until its successor arrives.
- **Read the competition.** Rivals announce sustained campaigns that respond to
  cash pressure, repeated losses and contested markets. Dossiers distinguish
  observed evidence from announced intent. Customer preference grows gradually
  from the price, service, schedule and reliability passengers actually experience. The planning
  calendar shows upcoming opportunities, aircraft introductions, airport
  programmes and deliveries. Board offers have decision deadlines and continuing
  obligations; declining is a valid choice.
- **Read the whole ledger.** Route contribution excludes company fixed costs.
  Reports reconcile it with airline profit, while forecasts also show cash after
  debt payments. Forecasts hold current world conditions and rival schedules fixed;
  future deliveries, disruptions and competitor moves can change the outcome.

Five long careers follow the Jet Age, Oil Crisis, Deregulation, Open Skies and
Low-Cost Wars. Their objectives are net worth, cumulative profit, passenger
boardings, connecting boardings and lifetime load factor respectively. Load-factor
careers also require 1.5 million boardings and three active routes to qualify.

Four shorter mandates use the full simulation:

| Mandate | Length | Challenge |
| --- | --- | --- |
| The Turnaround | 16 quarters | Restore profitability with an aging fleet and debt |
| Atlantic Crossing | 20 quarters | Build a long-haul operation from London |
| Sixteen Quarters of Oil | 16 quarters | Earn profits with fuel starting at 160% |
| Fortress Hub | 24 quarters | Grow connecting traffic through an established hub |

Concise quiet-quarter reports are optional in Display settings. The first three
quarters, decisions, disruptions, losses and large swings still show the full
report. No quarter advances automatically. Optional map diagnostics report the
actual device's frame intervals; see [performance and validation](PERFORMANCE.md)
for reproducible algorithm and browser workloads.

## Your workspace

Four persistent destinations keep navigation, cash, objectives and quarter review
on screen: **Desk** for prioritized decisions and upcoming commitments,
**Network** for the map, routes and airports, **Fleet** for owned aircraft,
orders and the market, and **Company** for finance, rivals and reports.

Routes and aircraft use compact comparison lists with focused inspectors. Route
fare, service and frequency edits show company profit and ending cash before one
undoable apply. Quarter review warns about unapplied drafts. New routes show
“Not flown yet”; actual results and next-quarter forecasts are labeled separately.
Desktop uses a navigation rail and adjacent inspectors; mobile uses bottom
navigation, full-width inspectors and catalog cards. List filters, scroll and
map position survive workspace navigation.

Every workspace shares one quarter draft. The plan tray previews combined profit
and cash, removes individual changes, and applies a validated batch with one undo.
The adviser can target scenario progress, passengers, connections, efficiency or
reliability while retaining a chosen cash reserve. Company → Outlook compares
four/eight quarters of known commitments, including replacement deliveries and
debt payments, under baseline and adverse conditions; it never predicts hidden
random draws or future rival decisions.

## Sound, display and controls

Original generative music follows five era palettes and responds to financial
pressure. **Sound mix** controls music, terminal ambience and effects separately;
Mute silences everything. Audio starts after a gesture and suspends when hidden.

**Display** offers larger text, reduced motion and lower map traffic density.
Motion follows the device preference by default. Map colors directly select
ownership, load factor, route margin or season; metric lines also use patterns.
Reports and launch dialogs support keyboard focus and Escape. On phones, city
and route inspectors fill the workspace and keep their own scrolling area.

Space or E opens quarter review; 1–6 selects a panel; Escape closes the current overlay
or selection; Ctrl/Cmd+Z undoes a planning action. Shortcuts stay out of form
controls. Saves are automatic, with export/import and visible recovery when
browser storage is unavailable. Visit once online to install the offline shell.

## Testing and profiling

```bash
npx playwright install --with-deps chromium webkit
npm test                   # Vitest watch mode
npm run test:unit          # engine, replay, accounting, balance and offline contracts
npm run test:e2e           # Chromium plus desktop/mobile WebKit coverage
npm run check              # lint, types, unit tests, build and startup-size budget
npm run ci                 # complete local gate, including browser tests
npm run goldens:update     # accept an intentional current-rules balance change
npx vite-node tools/profile-planning.ts
npx vite-node tools/profile-decisions.ts
npx vite-node tools/balance-report.ts experiment 6 /tmp/balance.json
```

The held-out rules-2 release matrix is in
[fixtures/balance-v2-report.json](fixtures/balance-v2-report.json): 162 careers,
nine scenarios, six seeds and three policies. Independent CI seeds guard survival,
winnability and runaway growth. Original rules-1 golden fixtures remain separate.

The browser's developer harness is `window.__harness`: `getState()`,
`dispatch(command)`, `endQuarter()`, `newGame(scenario, seed)`, `getReplay()` and
`reset()`. See [CLAUDE.md](CLAUDE.md) for architecture rules and
[PLAN.md](PLAN.md) for the design. [IMPLEMENTATION.md](IMPLEMENTATION.md) tracks
the improvement programme and its validation.

## Deploying

CI checks each push and pull request. The eager JavaScript bundle must stay below
190 KiB gzip. Chromium covers the complete browser suite; WebKit covers planning,
responsive layouts, preferences and hot-seat recovery, with separate phone runs.
On `main`, Pages receives the exact checked build artifact only after all checks
and browser tests pass. Enable GitHub Pages with GitHub Actions as its source.
