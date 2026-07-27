# Load Factor — Design & Engineering Plan

A web-based airline business simulation inspired by Aerobiz Supersonic (SNES),
with the emphasis shifted further toward route building, fleet strategy, and
business management. The player runs an airline across decades: queue for
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

- Open/close routes between cities where the airline holds slots. A new
  route must touch the airline's network — its HQ or a city it already
  serves. Airlines build networks, never disconnected cherry-picked pairs;
  slot request is therefore a directional expansion decision.
- Set each route's fare level (±2 steps around a distance-based base fare) and
  service level (1–3: no-frills → premium).
- Assign/unassign owned aircraft to routes; order new aircraft (delivered
  after a lag of 2–4 quarters) or cancel an order (the maker keeps a
  deposit); lease, buy used, refit cabins; sell old ones.
- Join an airport's waiting list for slots, leave it, or hand capacity back.
- Take or repay loans.

**Resolution phase** (`endQuarter`, fixed deterministic order — see §3.3):
waiting lists, rival AI turns, deliveries, world economy and events, route
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
- **Cabin fits.** Each airframe carries a cabin configuration — high-density
  (more seats, less appeal), standard, or premium (fewer seats, more appeal
  and higher revenue per pax). Refits cost a slice of list price. The
  hardware axis under the soft-product service level.
- **Market share.** Airlines serving the same pair split demand by
  attractiveness weight = f(frequency, cabin, service level, fare level,
  brand). Cheap fares and better service win share but cost margin.
- **Brand.** A per-quarter marketing budget (`set_marketing`, levels 0–3)
  multiplies the airline's share weight on every pair it flies. The spend
  scales with network size and lands in its own cost bucket; rivals hold a
  personality-set level while liquid and go dark when cash thins.
- **Load factor & revenue.** Pax flown = min(share of pair demand adjusted by
  fare elasticity, capacity). Load factor = pax/capacity. Revenue = pax ×
  fare (distance-based base × fare-level multiplier).
- **Seasonality.** Tourism demand peaks in a city's summer quarter and dips
  in its winter (hemisphere by latitude sign, Q3 north / Q1 south), amplitude
  scaling with the tourism rating (`SEASON_TOUR_BP_PER_POINT`). Beach towns
  breathe with the calendar; business capitals barely notice.
- **Spool-up.** A route attaches only part of its demand share for its first
  quarters flown (`ROUTE_SPOOL_BP`, monopoly or contested alike) — travelers
  have to learn it exists. Incumbency is worth something, and a raid takes
  quarters to bite.
- **Connecting traffic.** After direct demand is seated, a share of demand on
  city pairs an airline serves at both ends _without_ a direct flight will
  take a one-stop over the airline's own network: best hub by total distance,
  detour capped, riding only spare seats on both legs, each leg sold at a
  through-fare discount. Hub-and-spoke emerges from real itineraries, not a
  bonus multiplier.
- **Costs.** The airplane and its people are the expensive part; the
  marginal flight is comparatively cheap. Per flight: fuel (burn/km ×
  distance × fuel index), landing fees, flight pay by block time. Per
  aircraft: crew salaries (paid whether it flies or not), ownership or lease,
  maintenance rising with age, admin. Per airline: fixed overhead plus
  quadratic route-count overhead. Per pax: service cost by service level.
  Trimming a schedule saves fuel and fees, never the payroll — capacity
  discipline is a real decision, not a free cost dial.
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
- **Eras & fleet progression.** Aircraft are real airframes (Caravelle, 727,
  DC-8, 747, 767, MD-11…) with gameplay-tuned stats, gated by availability
  windows (piston twins → early jets → widebodies → efficient twins). Old
  types stop being sold, keep flying, and age into maintenance hogs — fleet
  renewal is a strategic drumbeat.
- **Slots.** Airports have genuinely tight capacity, and slots are **rented,
  not auctioned** (`engine/slots.ts`). You pay a one-off fee to join a city's
  waiting list; lists are served in the order they were joined, two slots at a
  time, no earlier than the following quarter. There is no bid, so the decision
  is WHEN to commit rather than how much to spend — and nobody is ever thrown
  off a list: being behind costs time, and leaving refunds the fee in full.
  Every slot held bills every quarter (the home base is exempt), so capacity
  you cannot fly is a standing cost rather than the silent confiscation
  use-it-or-lose-it used to perform; `release_slots` hands it back.
  Rival campaigns are **declared**: a carrier names the authority it will
  court (`slotInterest`) a quarter before it queues there and holds that target
  until it lands, so the map can ring the city and the player can get to the
  list first.
- **Airport building programmes.** Every airport expands on a published
  schedule — a per-city phase over a fixed cadence, derived from a stateless
  hash so the UI can read the calendar arbitrarily far ahead. A full airport is
  therefore a date to plan around, not a wall: wait for the new terminal, or go
  where nobody is queuing.

### 2.4 Scenarios & difficulty

A scenario defines: era window (start year, quarters), starting city/region
per airline, starting cash/fleet/slots, rival count and personalities,
objective, and event-deck weights. A scenario is a **race over a fixed
window**: victory is scored only when the final quarter resolves, and the
player must finish **#1 among the airlines on the scenario metric** (net
worth in scenario 1) _and_ clear an absolute qualifying floor (so limping
past weak rivals is not a win). There is no early exit; bankruptcy loses at
any time. Later scenarios can swap the metric (pax share, regional
dominance) without changing the shape.

The difficulty contract (asserted by balance tests, tuned over milestones):

- A naive bot (opens obvious routes, never adjusts fares) should _fail_ the
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

1. All randomness flows from seeded xoshiro128** streams stored **in\*\*
   `GameState` (`src/engine/rng.ts`), one substream per subsystem (economy,
   events, rivals, offers) so adding a draw to one never reshuffles
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
3. Airport waiting lists are served in queue order while capacity lasts
   (deterministic — no RNG stream).
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
  integrity, demand model shape, command validation, slot queueing, turn
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
  factors), Fleet (orders, ages, utilization), Airports (slots, rent,
  waiting lists, build schedule), Finance (P&L, loans), Report (event log).
- **End Quarter** button resolves and presents the quarterly report.
- `window.__harness` (dev/e2e): `getState()`, `dispatch(cmd)`,
  `endQuarter()`, `newGame(scenario, seed)`, `getReplay()`, `reset()`.
- Save = `(scenario, seed, command log)` in localStorage; export/import as
  text. Replays are shareable by construction.

## 7. Repo layout

```
src/engine/       pure sim: rng, types, newGame, commands, turn, market,
                  slots, worldEvents, rivals, invariants
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
  - greedy bots, simulate. Tests: rng, determinism, turn accounting,
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

**Status:** the full M0–M6 ladder has landed. M5 runs five scenarios (Jet
Age, Oil Crisis, Deregulation, Open Skies, and the 2000s Low-Cost Wars
from Barcelona) with the unlock chain, achievements, the daily seed
challenge, and a hall of fame. M6's presentation layer is in place
(decade-tinted map with real per-era palettes, globe projection, ambient
traffic that wears its metal, sound, PWA, shareable challenge links that
carry a duel target). Systems added beyond the ladder through the
iteration loop: brand/marketing in the share battle, route spool-up with
market memory, hemisphere seasonality, world index history, three save
slots with JSON export/import (finished careers preserved as replayable
records), TSV spreadsheet exports of every comparison table, a
quarter-archive newspaper with an annual review, in-context legends for
every system plus a handbook, and modern-era world events (travel slump,
alliance boom). The §2.4 difficulty contract is asserted literally: loans
amortize, hubs pay transfer handling, and no pinned career may finish
above 10× its scenario's qualifying floor. The reference bot, the rival
personalities, and the fuzz genome all run one shared strategy brain
(src/engine/policy.ts) — personalities and genomes are dials, not forks.

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

## 10. Multiplayer (design — not yet built)

The engine was built for this without knowing it. Three properties do all the
heavy lifting, and each is already enforced by tests:

- **Determinism** (§3.2): a game is `(scenario, seed, commands)`; two machines
  fed the same inputs produce byte-identical states.
- **Commands are per-airline**: `applyPlanningCommand(state, airlineIdx, cmd)`
  takes a seat index, and rivals already issue their moves through the same
  entry point (`rivals.ts`). "The player" is a UI convention, not an engine
  concept — any airline slot can be a human.
- **`hashState`** (harness): a cheap per-quarter fingerprint of the full state.

### 10.1 The model: lockstep, simultaneous quarters

Nobody ever transmits game state. Each quarter, every human seat submits its
command list; every client applies all seats' commands in a fixed order and
calls `endQuarter`. Everyone simulates the identical game locally.

- **Seats** are airline indices. Empty seats stay AI (the shared policy brain
  already plays them through commands), which gives drop-in/drop-out and
  timeout handling for free: a seat that misses the deadline is played by its
  AI for that quarter.
- **Ordering**: within a quarter, seat batches apply in seat order, and the
  engine's fixed resolution order (§3.3) does the rest. Contested resources
  (slot queues, used aircraft, bidding) already resolve deterministically
  among four airlines. The within-quarter tiebreak should rotate with the
  quarter index so no seat holds a standing edge.
- **Desync and cheating are the same problem with the same answer**: exchange
  `hashState` alongside each quarter's commands. Any disagreement is
  detectable immediately, and any finished game is verifiable by replaying
  `(scenario, seed, commands)` from scratch — the replay system is the
  anti-cheat.
- **Hidden information**: there is none in `GameState` (the intel panel is a
  UI filter). Fine for friendly play. Ranked play adds commit-reveal per
  quarter — submit `hash(commands + salt)`, reveal after all seats commit —
  which removes last-mover advantage without touching the engine.
- **Career length**: multiplayer scenarios want 20–32 quarters, not 80.

### 10.2 Wire format: deltas, never history

Measured with the harness (greedy bot, jet_age): a player issues ~5–7
commands per quarter; a full 80-quarter log is 25.6KB of JSON (3.1KB
deflated). So links that carry the whole history grow without bound and are
already marginal by mid-career — the turn payload must be a **delta**:

```
{ gameId, quarter, seat, commands[], parentHash }
```

One quarter's commands deflate+base64url to roughly 150–250 bytes; with
envelope and hash a turn link stays **under ~400 characters forever**,
independent of game length. Both clients already hold the prior state — they
have been simulating all along and persist locally (the save system). The
full log exists in exactly two places: local storage, and the recovery path —
a cold rejoin or a finished-game verification uses the existing career
export/import file, not a URL.

### 10.3 Threat model (adversarial game state)

The security property everything rests on: **state is never accepted from the
wire.** A turn link carries commands, and the receiver folds them through its
own engine, which validates each one exactly as it validates the local
player's. An illegal state cannot be injected — only proposed, move by move,
to a rules engine the victim runs. The hashes are sync/integrity checks, not
authentication (FNV-1a is not cryptographic and does not need to be here: a
collision would not help an attacker, because the receiver derives state from
the commands, never from the hash).

Attacks and their answers, each with a test in `mp.test.ts`:

- **Forged authorship** — commands tagged with the opponent's seat: rejected
  at the trust boundary before the engine sees them.
- **Stale / replayed / cross-game links**: the expect-hash and gameId checks
  refuse them with distinct human-readable reasons.
- **Tampered deltas**: replaying must land on the sender's result hash.
- **Sitting-shape smuggling** — the quiet cheat hashes cannot see: a delta
  packing several `end_quarter`s would let a player resolve quarters solo
  while the opponent's airline idles, with every hash checking out.
  `validSittingShape` enforces the protocol's one legal shape: an opening
  resolves nothing; every other sitting resolves exactly one quarter; nothing
  follows a game-ending resolution; deltas are non-empty and bounded (200
  entries).
- **Unknown or malformed commands** (arbitrary JSON): the engine's command
  switch rejects unknown types (`default` case — "never throw on user input"
  includes input a hostile opponent authored), and the fold is wrapped so any
  residual throw becomes a refusal, not a crash.
- **Compression bombs**: a link-sized deflate payload can inflate to
  gigabytes; the decoder caps encoded input (64KB) and streamed inflation
  (512KB) and returns null past either.

Accepted risks, by design: the quarter's **closer sees the opener's moves**
before committing (alternates fairly; commit-reveal in MP3 removes it);
**local takebacks** before sending (symmetric — both sides can re-plan their
own sitting); **full state visibility** (there is no hidden information);
**abandonment** (no reply ever comes — needs deadlines, i.e. a server). A
modified client can also simply play badly on purpose or feed its own UI
anything it likes — that is its own machine; the protocol only guarantees it
cannot corrupt YOURS.

### 10.4 Delivery ladder

- **MP0 — Hot-seat.** Two humans, one machine, alternating planning within a
  quarter. Zero networking. Forces the one real refactor: thread a seat index
  through the UI (session, panels, map selection) instead of assuming
  airline 0. Everything later builds on this seam.
- **MP1 — Async duel by link.** Extends the existing challenge/duel links:
  each turn produces a delta URL (format above) pasted over any channel.
  Works on static hosting with no server. Two players; the UI shows "waiting
  for their quarter" state and verifies `parentHash` before applying.
- **MP2 — Relay server.** A room keyed by `(scenario, seed)`: clients POST
  their quarter's command batch, the server broadcasts when all seats are in
  (or the deadline passes and AI fills the gap). The server is a **mailbox —
  it never runs the engine**, so it is ~200 lines on any substrate (Durable
  Object, Supabase channel, one WebSocket process). Turn timers live here;
  wall-clock never enters the engine.
- **MP3 — Ranked.** Commit-reveal, server-side replay verification of final
  hashes, a ladder. Only worth building if MP2 finds an audience.

Explicitly rejected: server-authoritative real-time. It discards the
determinism asset, requires hosting the engine, and buys nothing for a
quarterly turn game.

### 10.5 Engine-side work (small, all additive)

- A `SeatConfig` on `GameState` or scenario: which airline indices are
  human. Rival AI skips human seats in `endQuarter`.
- Rotate the within-quarter seat application order by quarter index.
- An engine-level guard that a command's seat matches its author (MP2+;
  hot-seat and links trust the channel).
- Nothing else: resolution, RNG, events, and serialization are already
  multiplayer-shaped.
