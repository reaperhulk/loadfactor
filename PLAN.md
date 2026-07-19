# Load Factor — Design & Engineering Plan

A web-based airline business simulation inspired by Aerobiz Supersonic (SNES),
with the emphasis shifted further toward route building, fleet strategy, and
business management. The player runs an airline across decades: negotiate for
airport slots, open routes, buy and assign aircraft, set fares and service
levels, survive fuel shocks and recessions, and out-grow rival airlines to hit
a scenario objective before the clock runs out.

The entire game runs on a pure, deterministic, headless simulation core. A full
playthrough is just `(scenario, seed, commands)` — replays, saves, bot
playtesting, golden tests, and balance fuzzing are all the same mechanism.
This document is the design contract; read it before architectural changes.

---

## 1. Design pillars

1. **Load factor is the game.** The core tension is filling seats profitably:
   capacity vs demand, fare vs volume, frequency vs aircraft utilization.
   Every system should ultimately push the player to think about that ratio.
2. **Decisions, then consequences.** Turn-based quarters: the player plans
   freely with full information about their own airline, commits, and watches
   the quarter resolve. No twitch, no time pressure — a thinking game.
3. **The map is an opponent.** Geography is real: range limits, distance
   economics, and regional demand make route networks a spatial puzzle, not a
   spreadsheet.
4. **Rivals make it a race.** 1–3 AI airlines compete for the same slots and
   passengers. Market share on a city pair is contested through fares,
   service, and frequency.
5. **Deterministic to the bit.** Same scenario + seed + commands ⇒ identical
   state, on every platform, forever. Randomness exists only as seeded streams
   stored in state. This is a gameplay feature (shareable seeds, replays) and
   the foundation of the test strategy.
6. **Everything testable headless.** The UI is a thin shell. Bots can play
   entire careers in CI; the difficulty curve is an asserted contract, not a
   hope.

## 2. Game design

### 2.1 The quarter loop

One turn = one calendar quarter. A scenario spans decades (e.g. 1960–1980 =
80 turns).

**Planning phase** (player acts, nothing resolves):
- Open/close routes between cities where the airline holds slots.
- Set each route's fare level (±2 steps around a distance-based base fare) and
  service level (1–3: no-frills → premium).
- Assign/unassign owned aircraft to routes; order new aircraft (delivered
  after a lag of 2–4 quarters); sell old ones.
- Start slot negotiations at new airports (spend cash for a chance at slots).
- Take or repay loans.

**Resolution phase** (`endQuarter`, fixed deterministic order — see §3.3):
rival AI turns, deliveries, negotiations, world economy and events, route
economics for every airline, financials, victory/defeat check. The quarter's
outcomes stream back as `GameEvent`s and land in the quarterly report: per
route pax, load factor, revenue, costs, profit; fleet utilization; market
news.

### 2.2 The economic model (v1)

Integer math throughout (money in $k, distances in km, percentages in basis
points where precision matters).

- **Demand.** Each city has authored ratings (population, business, tourism,
  1–10) and a region. A city pair's base weekly demand uses a gravity-style
  formula: product of city masses, scaled by a distance-band factor (very
  short routes lose to ground transport; medium-haul is the sweet spot;
  ultra-long-haul thins). Global economy index, regional event modifiers, and
  a small per-pair noise term (stateless hash of seed+turn+pair, so draws
  never reshuffle) multiply on top.
- **Capacity & frequency.** An aircraft assigned to a route flies
  `floor(weeklyBlockMinutes / roundTripMinutes)` round trips per week;
  round-trip time comes from distance/speed plus turnaround. Weekly seat
  capacity = Σ seats × round trips × 2 legs.
- **Market share.** Airlines serving the same pair split demand by
  attractiveness weight = f(frequency, service level, fare level). Cheap
  fares and better service win share but cost margin.
- **Load factor & revenue.** Pax flown = min(share of pair demand adjusted by
  fare elasticity, capacity). Load factor = pax/capacity. Revenue = pax ×
  fare (distance-based base × fare-level multiplier).
- **Connecting traffic.** After direct demand is seated, a share of demand on
  city pairs an airline serves at both ends *without* a direct flight will
  take a one-stop over the airline's own network: best hub by total distance,
  detour capped, riding only spare seats on both legs, each leg sold at a
  through-fare discount. Hub-and-spoke emerges from real itineraries, not a
  bonus multiplier.
- **Costs.** Per flight: fuel (burn/km × distance × fuel index), landing
  fees, crew by block time. Per aircraft: maintenance rising with age,
  ownership overhead. Per airline: fixed overhead. Per pax: service cost by
  service level.
- **Finance.** Loans have principal and quarterly interest tied to the
  economy; a debt ceiling scales with fleet value. Bankruptcy (cash below
  the failure floor at quarter end for two consecutive quarters) = defeat.

### 2.3 World systems

- **Economy.** A global index (basis points, ~10000 = neutral) follows a
  seeded random walk with mean reversion; fuel price index likewise, plus
  event shocks.
- **Events.** Each quarter can draw world events from an era-weighted deck:
  oil shock, recession, boom, Olympics (host-city demand spike), regional
  conflict (demand collapse), new-aircraft fanfare. Events have durations and
  modifiers; they are announced in the report.
- **Eras & fleet progression.** Aircraft are fictional-but-plausible analogs
  gated by availability windows (turbo-props → early jets → widebodies →
  efficient twins). Old types stop being sold, keep flying, and age into
  maintenance hogs — fleet renewal is a strategic drumbeat.
- **Slots.** Airports have finite slot pools by city size. Negotiations cost
  cash and resolve with a seeded roll whose odds scale with spend and slot
  scarcity. Rivals compete for the same pools. Slots are use-it-or-lose-it:
  a city where an airline leaves 2+ slots unused for 4 consecutive quarters
  hands one back to the authority (the HQ is exempt).

### 2.4 Scenarios & difficulty

A scenario defines: era window (start year, quarters), starting city/region
per airline, starting cash/fleet/slots, rival count and personalities,
objective, and event-deck weights. A scenario is a **race over a fixed
window**: victory is scored only when the final quarter resolves, and the
player must finish **#1 among the airlines on the scenario metric** (net
worth in scenario 1) *and* clear an absolute qualifying floor (so limping
past weak rivals is not a win). There is no early exit; bankruptcy loses at
any time. Later scenarios can swap the metric (pax share, regional
dominance) without changing the shape.

The difficulty contract (asserted by balance tests, tuned over milestones):
- A naive bot (opens obvious routes, never adjusts fares) should *fail* the
  first scenario's objective but survive solvency.
- A competent greedy bot should win the first scenario on most seeds.
- No strategy should be able to 10× the objective (fuzzer's job to find one).

## 3. Engine architecture — a pure, deterministic core

### 3.1 The shape of the engine

- `src/engine/` — pure TypeScript. No DOM, no `Date`, no `Math.random`, no
  I/O, no scheduling (ESLint-enforced). State in, state out.
- `GameState` is plain JSON data: no classes, Maps, functions, or `undefined`
  holes. Mid-game serialize/restore is lossless (proved by tests).
- Three entry points:
  - `newGame(scenarioId, seed)` → `GameState`
  - `applyCommand(state, command)` → `{ state, events }` — validates and
    applies one player action during planning (invalid commands reject with
    an event, never throw).
  - `endQuarter(state)` → `{ state, events }` — resolves the quarter.
- A replay is `(scenarioId, seed, Command[])` where `end_quarter` is itself a
  command. Feeding the log back through the entry points reproduces the game
  bit-for-bit.
- `GameEvent`s are the only observable channel: the UI renders them, tests
  assert on them, the quarterly report is built from them.

### 3.2 Determinism rules (enforced, not aspirational)

1. All randomness flows from seeded xoshiro128** streams stored **in**
   `GameState` (`src/engine/rng.ts`), one substream per subsystem (economy,
   events, negotiations, rivals) so adding a draw to one never reshuffles
   another. Draws return the next RNG state; nothing mutates.
2. Where per-entity noise would make draw order fragile (route demand noise),
   use stateless hashing of `(seed, turn, key)` instead of a stream.
3. Integer/fixed-point math only. No `Math.sin/cos/pow/exp/log/asin/acos` in
   engine or data — great-circle distances are precomputed into
   `src/data/distances.gen.ts` by `npm run gen:distances` (regenerate when
   cities change; the generator may use any math it likes).
4. Iteration order is stable everywhere: airlines by index, routes/fleet/
   loans by ascending id, city pairs sorted lexicographically. No object-key
   iteration in resolution paths.
5. Real time never enters the engine. Time is the turn counter; the calendar
   is derived presentation.

### 3.3 Quarter resolution order (fixed, documented, tested)

1. Rival AI: each rival (ascending index) generates commands via its policy
   (deterministic, `rivals` stream for tie-breaks) and applies them through
   the same `applyCommand` validator as the player.
2. Aircraft deliveries arrive; orders age.
3. Slot negotiations resolve (`negotiations` stream).
4. World update: economy index walk, fuel walk, event expiry, new event draw
   (`economy`/`events` streams).
5. Route economics for every airline (pure arithmetic + stateless noise):
   demand → shares → pax per pair, then connecting itineraries over spare
   seats → revenue/costs per route.
6. Financials: service costs, overheads, maintenance, loan interest,
   quarterly cash delta applied.
7. Aging (aircraft quarters), stats history append, solvency and objective
   checks.
8. Slot idle decay (use-it-or-lose-it, HQ exempt), then turn increment.

## 4. Why this architecture serves the tests

Because the engine is a pure function of `(scenario, seed, commands)`:
- any bug report is a replay file;
- golden tests pin entire careers with one hash;
- property tests can hurl thousands of random command sequences at the
  validator, asserting invariants instead of outcomes;
- balance is testable: bots play the scenario in CI and their outcomes are
  asserted as an envelope;
- a fuzzer can search strategy space for curve-breaking builds — findings
  get pinned as regression tests.

## 5. The test harness

- **Unit (Vitest)** — `src/engine/__tests__/`: rng streams, distance data
  integrity, demand model shape, command validation, negotiation odds, turn
  resolution accounting (cash deltas reconcile with reported P&L).
- **Determinism (keystone)** — same seed+commands twice ⇒ identical state
  hash; JSON round-trip mid-career ⇒ identical continuation; different seeds
  ⇒ different outcomes.
- **Golden replays** — named bot careers pinned in `fixtures/goldens.json`
  (state hash + headline stats per checkpoint turn). `npm run goldens:update`
  accepts intentional balance changes; the diff must be committed and called
  out.
- **Property-based (fast-check)** — random command sequences never throw,
  never produce NaN/negative-capacity/load-factor>100%; cash ledger always
  reconciles; serialize/restore at random turns is lossless.
- **Balance envelope** — `src/harness/__tests__/balance.test.ts`: the greedy
  bot must win scenario 1 within [X, Y] net worth across the pinned seed set;
  the naive bot must survive but lose. Re-derive numbers when the curve
  intentionally moves.
- **Perf budget** — a full 80-quarter bot career must resolve under a wall
  budget (engine stays fast enough for instant replays and deep fuzzing).
- **E2E (Playwright)** — real UI: start scenario, open a route, end quarter,
  read the report; plus `window.__harness` hooks.
- **Fuzzer (milestone M4)** — seeded evolutionary search over strategy
  genomes (route aggression, fare posture, fleet mix, debt appetite) hunting
  strategies that beat the objective envelope; CI smoke sweep + scheduled
  deep hunt, past finds pinned.

## 6. UI layer

React shell over the headless engine; the UI never mutates state — it calls
`applyCommand`/`endQuarter` through a session wrapper and re-renders.

- **Map view**: SVG equirectangular world map; cities as dots sized by
  demand, routes as great-circle-ish arcs, click city-to-city to open routes.
  (Cities carry lat/lon for presentation; the engine only ever sees the
  precomputed distance table.)
- **Panels**: Routes (fares/service/assignments + last quarter's load
  factors), Fleet (orders, ages, utilization), Airports (slots,
  negotiations), Finance (P&L, loans), Report (event log).
- **End Quarter** button resolves and presents the quarterly report.
- `window.__harness` (dev/e2e): `getState()`, `dispatch(cmd)`,
  `endQuarter()`, `newGame(scenario, seed)`, `getReplay()`, `reset()`.
- Save = `(scenario, seed, command log)` in localStorage; export/import as
  text. Replays are shareable by construction.

## 7. Repo layout

```
src/engine/       pure sim: rng, types, newGame, commands, turn, market,
                  negotiation, worldEvents, rivals, invariants
src/engine/__tests__/
src/data/         content as data: cities, distances.gen (generated),
                  aircraft, scenarios, events, constants
src/harness/      headless tooling: hash, bots, simulate (+ __tests__)
src/ui/           React shell, SVG map, session, window.__harness
e2e/              Playwright suite
tools/            gen-distances.mjs (authoring-time codegen)
fixtures/         goldens.json
.github/workflows ci.yml (lint+types+unit+build, then e2e), deploy.yml (Pages)
```

Scripts: `dev`, `build`, `test`/`test:unit`, `test:e2e`, `lint`, `typecheck`,
`gen:distances`, `goldens:update`, `check` (full local gate — run before
committing).

## 8. Milestones

- **M0 — Scaffold (this PR).** Toolchain, CI, deploy, purity lint, PLAN.
  Engine steel thread: `newGame` → commands → `endQuarter` with the v1
  economic model, one scenario ("Jet Age", 1960–1980), ~30 cities, 8
  aircraft types, 2 rivals with a simple greedy policy. Harness: hash, naive
  + greedy bots, simulate. Tests: rng, determinism, turn accounting,
  property, goldens. Minimal UI: map, panels, end-quarter report. E2E smoke.
- **M1 — Playable depth.** Fare elasticity tuning, service quality effects,
  slot scarcity pressure, quarterly report UI polish, save/load + replay
  viewer, balance envelope tightened.
- **M2 — Fleet strategy.** Leasing, used-aircraft market, maintenance
  schedules, delivery slots/queues, fuel hedging; era transitions with
  aircraft retirements.
- **M3 — Rivals with teeth.** Rival personalities (hub-fortress, price-war,
  premium), route-level retaliation, slot bidding wars, takeover/merger
  endgame.
- **M4 — The fuzzer.** Strategy-genome evolutionary search, CI smoke sweep,
  scheduled deep hunt, findings pinned as regressions.
- **M5 — Scenario campaign.** 4+ scenarios across eras (1960 Jet Age, 1974
  Oil Crisis, 1985 Deregulation, 2000s LCC wars), unlock chain, achievements,
  daily seed challenge.
- **M6 — Presentation.** Period styling, map polish, sound, PWA install,
  shareable replay links.

## 9. Risks & mitigations

- **Economic model degenerates** (one dominant strategy). Mitigation: the
  balance envelope + fuzzer are first-class from M0/M4; distance bands,
  slot scarcity, and rival retaliation each punish monocultures.
- **Turn resolution becomes order-sensitive spaghetti.** Mitigation: §3.3 is
  a documented contract with an accounting test that reconciles every cash
  delta against reported events.
- **Integer math awkwardness** (elasticity curves, share splits). Mitigation:
  basis-point fixed point everywhere, lookup tables for any curve, generator
  scripts may use float math at authoring time.
- **Real-world data drift** (cities need retuning). Mitigation: ratings are
  data, distance table is generated, goldens make retunes explicit diffs.
- **UI scope creep.** Mitigation: the engine is the product in early
  milestones; UI stays a thin command shell until M5/M6.
