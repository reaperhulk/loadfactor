# Load Factor

An airline business simulation inspired by Aerobiz Supersonic — with the dial
turned toward the parts we loved most: route building, fleet strategy, and
cold-blooded quarterly economics. Negotiate airport slots, open routes, buy
fictional-but-plausible jets across the eras, set fares and service, ride out
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

- **Expand**: negotiate for slots at new airports, then open routes between
  cities you hold slots at.
- **Equip**: order aircraft (they deliver quarters later), assign them to
  routes, retire the fuel-hogs before their maintenance bills bite.
- **Price**: set each route's fare and service level — chase load factor with
  cheap seats or yield with premium service, and fight rivals for share.
- **Survive**: quarterly interest, fuel indexes, recessions, and events with
  era flavor. Bankruptcy is two bad quarters away.
- **Win**: the scenario is a race over a fixed window — finish the final
  quarter #1 among the airlines on the scenario metric (net worth, market
  share) while clearing its qualifying floor.

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

**M0 — scaffold, in iteration.** Deterministic engine steel thread (quarterly
turns, route economics, slot negotiations, world events, loans, two rival
AIs), one race scenario (Jet Age, 1960–1980: finish #1 by net worth), ~30
cities, 8 aircraft types, bot harness, determinism/property/golden/balance
tests, CI and Pages deploy. UI: responsive map + panels from phone to
desktop (viewport-regression tested), keyboard shortcuts, and a reward
layer — route draw-in arcs, ambient planes on served routes, world-event
map halos, celebration toasts, money roll-ups, ranked game-over podium —
all reduced-motion aware. See PLAN.md §8 for the milestone ladder.
