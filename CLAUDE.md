# Load Factor — airline business simulation

Read PLAN.md before making architectural changes — it is the design contract.

## Project structure

- `src/engine/` — Pure, deterministic simulation. **No DOM, no `Date`, no
  `Math.random`, no I/O, no scheduling.** ESLint enforces this.
- `src/engine/__tests__/` — Unit, determinism, property, and golden tests.
- `src/data/` — Content as plain data: cities (real world, authored demand
  ratings), `distances.gen.ts` (generated — run `npm run gen:distances`
  after editing cities, never edit by hand), fictional aircraft catalog with
  era windows, scenarios, world events, tuning constants.
- `src/harness/` — Headless tooling: strategy bots, career simulation, state
  hashing. `src/harness/__tests__/` holds the balance envelope and perf
  budget.
- `src/ui/` — React shell + SVG map. `session.ts` wraps the engine; commands
  are the only write path.
- `e2e/` — Playwright suite driving the real UI plus `window.__harness`.
- `tools/` — authoring-time codegen (may use float math; engine may not).
- `fixtures/goldens.json` — pinned outcomes of named bot careers.

## Dev commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm test` — Vitest watch; `npm run test:unit` for one-shot
- `npm run test:e2e` — Playwright browser suite (builds + serves automatically)
- `npm run check` — full local gate: lint + typecheck + unit tests + build.
  **Run this before committing.**
- `npm run goldens:update` — regenerate golden fixtures after an intentional
  balance change; commit the diff and say so in the commit message.
- `npm run gen:distances` — regenerate the city distance table after editing
  `src/data/cities.ts`.

## Architecture rules (non-negotiable)

1. The sim advances in **quarterly turns**. `applyCommand(state, cmd)`
   validates one planning action; `endQuarter(state)` resolves the quarter in
   the fixed order documented in PLAN.md §3.3. Real time never enters the
   engine.
2. All randomness flows from the seeded RNG streams stored **in** `GameState`
   (`src/engine/rng.ts`), one substream per subsystem. Per-entity noise uses
   stateless `(seed, turn, key)` hashing, never stream draws. No
   `Math.random` in engine/data/harness (non-test).
3. Player actions are serializable `Command`s; observable effects are
   `GameEvent`s. Invalid commands reject with an event — engine entry points
   never throw on user input. The UI never mutates state directly.
4. `GameState` stays plain JSON data. Serialize/restore mid-career must be
   lossless (determinism.test.ts proves it). A full game is
   `(scenario, seed, commands)` — replays and saves are the same object.
5. Gameplay math is integer/fixed-point (money in $k, basis points for
   rates). No `Math.sin/cos/pow/exp/log/asin/acos` in the engine — distances
   are precomputed data.
6. Iteration order is stable: airlines by index, entities by ascending id,
   city pairs sorted. No object-key iteration in resolution paths.
7. New engine behavior ships with tests. Balance-affecting changes must
   update `fixtures/goldens.json` (via the script) and keep the balance
   envelope green — re-derive its numbers when the curve intentionally moves.

## Browser playtesting

`window.__harness` (installed by the UI): `getState()`, `dispatch(cmd)`,
`endQuarter()`, `newGame(scenarioId, seed)`, `getReplay()` (scenario + seed +
full command log), `reset()`. Deterministic repro: `newGame(s, seed)` then
replay the logged commands.
