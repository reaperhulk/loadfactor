# Proposed operations redesign

Status: proposal. The existing grounding simulation has not been changed by this
review. Same-quarter purchase refunds are implemented separately.

## Problem

The current engine starts random failures at 28 quarters of age, removes the
whole aircraft for the following quarter, and charges 4% of its list price per
failure. It deducts reputation even when standby cover preserves the service.
Preventive maintenance also takes an entire quarter. A spare can replace one
whole assigned airframe, and eligibility checks range but not crew compatibility.
This makes a normal middle-aged fleet feel disposable and a small airline need
an implausibly large dedicated reserve fleet.

For context, BTS reports US carrier average fleet age of 14.7 years in 2023:
https://data.bts.gov/stories/s/Fleet-Mix/fd9d-t7sq/
National Aviation Academy distinguishes overnight checks from heavy checks that
take weeks, with schedules depending on type, hours and cycles:
https://www.naa.edu/types-of-aviation-maintenance-checks/
The numeric targets below are proposed game tuning, not universal airline data.

## Recommended model

1. **Availability, not binary quarterly groundings.** Routine defects consume
   hours or a few days; major repairs are uncommon and consume longer intervals.
   Only the affected flying is unavailable. Repair cost follows severity and
   equipment, not a fixed percentage of the entire airframe's purchase price.
   Keep the quarterly player turn; resolve downtime inside that turn.
2. **Wear and maintenance history.** Track flight hours, cycles and time since
   checks alongside age. Remove the seven-year threshold. Age should gradually
   increase maintenance expense and inspection needs. A maintained 15–20-year-old
   aircraft remains a viable economic choice. Track storage separately from use.
3. **Automatic coverage.** Route assignments describe the preferred schedule.
   Dispatch compatible available aircraft and unused block hours across routes,
   then dedicated standby capacity. Check range, base/ferry reach and crew type
   compatibility; a 737 crew cannot become a 747 crew. Do not rewrite the
   player's assignments or require manual swaps after every defect.
4. **Reserve capacity as a policy.** Offer schedule slack and standby aircraft
   together. Initially test 5–10% unscheduled capacity as a useful buffer, varying
   by fleet size and reliability. A two-aircraft airline can leave hours free
   instead of having to buy a third aircraft. Show the earnings cost of slack.
   Price optional short-term substitute capacity for genuinely uncovered gaps.
5. **Plannable checks.** Forecast due checks and spread them through low-demand
   periods. Routine work is included in the operating plan. Heavy work blocks a
   displayed number of days, and the planner quotes coverage and cost. Maintenance
   improves reliability without resetting age or granting temporary immunity.
6. **Passenger consequences.** Charge repair/recovery costs for all incidents,
   but harm reputation only for delays, cancellations and missed connections that
   actually reach passengers. Covered defects belong in the operational summary;
   only uncovered service needs a prominent alert.

Example: a four-day defect on one aircraft out of ten represents about 0.44% of
quarterly fleet-days before coverage, rather than losing 10% of the fleet for the
quarter. Coverage still depends on when and where the defect occurs; a global
quarterly spare-hours total must not hide simultaneous outages or teleport metal.

## UI

- Fleet: availability, scheduled utilization, check due date and expected cost.
- Operations: spare hours by base/type, coverage forecast, affected routes and
  optional reserve policy. Distinguish deliberately unused capacity from waste.
- Quarter report: scheduled/completed flights, covered disruptions, cancelled
  flights, passenger impact and recovery cost, reconciled to the financials.
- Forecast: typical result and adverse disruption scenario, not a claim to know
  the next random failure. A sample message: “Four days unavailable; three covered
  by fleet rotation, one day's flying cancelled.”

## Implementation order and acceptance

First implement fractional downtime and passenger-based consequences. Then add
compatible pool dispatch and reserve policies; finally update checks, forecasts,
reports and rival/bot decisions to use the same resolver. Ship changed historical
simulation behavior behind a new rules identity with a deliberate save-upgrade
path; preserve existing replay outcomes.

Use deterministic incident intervals and a bounded internal operations timeline.
Do not rerun the passenger market for every day or flight: aggregate actual
available trips/seats before resolving the market once per quarter. Derive the
crew/fleet assignments from the plan without mutating it during display queries.

Tests must cover a short disruption, complete spare coverage with no reputation
loss, simultaneous failures that exhaust spares, incompatible crews, isolated
bases, a spare's own maintenance, checks spanning a quarter boundary, and normal
service restoration. Every minute/aircraft may be allocated only once; capacity,
passengers and cost must reconcile. Small airlines and older maintained fleets
must remain viable. Benchmark full careers and mobile planning before release.
