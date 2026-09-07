# Performance and gameplay validation

## Reproducible algorithm comparison

Measured in the same workspace before and after the September 2026 planning
optimizations. Both runs use rules 3, scenario `jet_age`, seed
`planning-profile-v2`, greedy policy, and identical checkpoint hashes. The
65-quarter case has 34 routes and 56 player aircraft. Timings are local Node
medians, not promises about phones or browser frame rates.

| Workload | 20 quarters, before → after | 40 quarters, before → after | 65 quarters, before → after |
| --- | --- | --- | --- |
| Company forecast | 1.03 → 1.10 ms | 1.94 → 1.76 ms | 1.65 → 1.50 ms |
| Balance schedules | 5.86 → 4.35 ms | 18.60 → 15.99 ms | 39.11 → 24.42 ms |
| Network advice | 16.46 → 8.89 ms | 59.78 → 34.09 ms | 94.50 → 64.35 ms |
| Expansion search | 17.10 → 15.57 ms | 39.32 → 36.10 ms | 39.38 → 39.62 ms |

Late-game schedule balancing improves about 38%; advice about 32%. Expansion
search is effectively unchanged. Forecast differences at this scale are noisy.
Advice option counts (18/33/49), feasible expansion counts (6), schedule profit
improvements (3411/10740/36959 $k), and all three state hashes are unchanged.

```bash
npx vite-node tools/profile-planning.ts 3
npx vite-node tools/profile-decisions.ts 3
# Use 4 to profile the current gameplay rules separately.
```

Changes that remove work:

- Build airline/hub adjacency in one pass; reuse indexed direct/connecting paths
  for comparisons on the same network. Route ownership, endpoints, ids and order
  invalidate the index; zero-capacity paths are filtered during each resolution.
- Precompute each leg's fare and demand ramp once per allocation pass. Reuse
  available-choice indices inside capped water filling instead of allocating
  nested arrays and temporary objects each round. Shared-seat allocation order
  and integer rounding remain unchanged.
- Skip the superseded direct-allocation pass for rules 2 and later.
- Reuse direct-market dispatch across fare/service candidates and unchanged rival
  schedules. Full-network checks still validate every recommended change.
- Share one comparison context across UI consumers of an immutable snapshot.
  Quotes, dispatches and topology caches are bounded; previous states have weak
  keys. Hidden outlook/calendar pages preserve controls without recalculating
  forecasts. Calendar rendering groups weeks once instead of scanning all rows
  for every aircraft.

Twenty-eight pinned careers cover current and legacy rules. Independent cached
versus uncached checks include service/fare/frequency changes, route replacement,
closures, unassigned aircraft, adverse operations, and cache eviction.

## Browser workload and device diagnostics

`e2e/performance.spec.ts` restores a genuine rules-4 65-quarter replay with 34
routes and 58 aircraft. It records save loading, globe rotation, advice, capital
outlook, operations calendar, repeated navigation and save/reload fidelity.
Desktop, phone, tablet and enlarged-text layouts check reachable controls and
horizontal overflow. Chromium and WebKit execute the workloads; the phone also
runs in the mobile WebKit project.

Each run attaches `workload.json` and screenshots to the Playwright report.
Measurements include frame-interval p95, long tasks where supported, DOM counts,
heap before/after collection where supported, save bytes and command-save time.
Gates prevent accumulated DOM copies, excessive retained heap and multi-second
adviser stalls. Frame samples are recorded rather than imposing a hardware-
dependent 60 fps assertion on shared CI hosts.

```bash
npx playwright test e2e/performance.spec.ts
npx vite-node tools/browser-workload.ts # regenerate after intentional rule changes
```

Settings → Display → **Map performance diagnostics** shows recent FPS, frame
p95, frames over 50 ms and approximate JS heap when the device exposes it. The
isolated sampler retains at most 120 intervals and stops in hidden tabs.

## Strategy and pacing coverage

The rules-4 release probe runs 108 careers: nine scenarios, two independent
`validation-v4` seeds, and naive/greedy/cautious/premium/budget/connector policies.
The existing CI matrix separately requires survival, viable wins, live rivals
and bounded growth; those gates were not relaxed. Commercial doctrine tests
prove distinct earned preferences and viable networks.

```bash
npx vite-node tools/balance-report.ts validation-v4 2 /tmp/balance-v4.json
```

The report includes actual leader changes, quarters within 60% of the leader,
action variety, proposed actions per quarter and repeated proposals. Proposal
counts include rejected bot commands; they measure automation repetition, not
human click counts. These measurements expose remaining balance and pacing work
without pretending that a small seed sample establishes universal fairness.
