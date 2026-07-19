# Load Factor

An airline business simulation inspired by Aerobiz Supersonic — with the dial
turned toward the parts we loved most: route building, fleet strategy, and
cold-blooded quarterly economics. Negotiate airport slots, open routes, buy
real airframes across the eras — Caravelles to 747s to MD-11s, set fares and service, ride out
oil shocks and recessions, and out-grow rival airlines before the scenario
clock runs out.

The whole game runs on a pure, deterministic, headless simulation core: a full
career is just `(scenario, seed, commands)`, so replays, saves, bot
playtesting, golden tests, and balance fuzzing are all the same mechanism.
Strategy bots play entire careers in CI and assert the difficulty curve.

See [PLAN.md](PLAN.md) for the full design and engineering plan, and
[CLAUDE.md](CLAUDE.md) for dev workflow and architecture rules.

## Playing

```bash
npm install
npm run dev     # then open http://localhost:5173
```

- **Found**: name your airline, pick its livery color, and choose any city as
  HQ — footholds derive from the geography around your home.
- **Expand**: negotiate for slots at new airports, then grow a CONNECTED
  network — every new route must touch your HQ or a city you already serve.
  Use-it-or-lose-it: idle slots go back to the authority. The Opportunities
  list ranks the richest unserved pairs and negotiation targets by market
  dollars.
- **Equip**: order or lease aircraft (they deliver quarters later), buy used,
  fit cabins dense or premium, assign airframes to schedules, and retire the
  maintenance hogs before the renewal forecast bites.
- **Price**: set each route's fare and service tier — chase load factor with
  cheap seats or yield with premium — and fight rivals seat-for-seat on
  contested pairs (the dossier's battle card shows the exact share math).
- **Connect**: unserved pairs one-stop over your own hubs; transfer hubs glow
  with connecting traffic on the map (flat or rotatable globe projection).
- **Survive**: quarterly interest, fuel indexes and hedges, recessions, oil
  shocks, and era events. Crews are salaried whether the metal flies or not.
  Bankruptcy is two bad quarters away and the HUD says so.
- **Win**: the scenario is a race over a fixed window — finish the final
  quarter #1 among the airlines by net worth while clearing its qualifying
  floor. The standings sheet and race chart keep the score honest.

## Testing

```bash
npm test               # vitest watch mode
npm run test:unit      # engine + harness suites (determinism, balance, goldens)
npm run test:e2e       # Playwright browser suite against the real UI
npm run check          # full local gate: lint + typecheck + unit + build
npm run goldens:update # accept intentional balance changes
```

The dev harness is exposed at `window.__harness` in the browser console:
`getState()`, `dispatch(command)`, `endQuarter()`, `newGame(scenario, seed)`,
`getReplay()`, `reset()`.

## Deploying

CI runs lint/typecheck/tests/build plus the Playwright suite on every push and
PR. `deploy.yml` publishes to GitHub Pages on pushes to main once Pages is
enabled for the repository (Settings → Pages → Source: GitHub Actions).

## Status

**In continuous iteration.** Deterministic engine (quarterly turns, route
economics with era cost inflation, slot negotiations, world events, loans),
81 real cities on a real landmass map with zoom + level-of-detail, city
dossier panels with in-context negotiation, three race scenarios (Jet Age
1960, Oil Crisis 1972, Deregulation 1985) against rival archetypes
(price-war / premium / fortress), save/resume + watchable replays, and a
reward layer (route draw-in arcs, ambient planes, event halos, toasts,
money roll-ups, ranked podium) — responsive from phone to desktop with
keyboard shortcuts, all reduced-motion aware. Testing: determinism,
property, golden, balance-envelope, scenario-smoke, perf, browser e2e, and
a deterministic evolutionary build fuzzer (CI smoke + weekly deep hunt).
See PLAN.md §8 for the milestone ladder.
