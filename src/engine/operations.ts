// Rules 3: deterministic calendar intervals, whole round trips and compatible
// recovery. Resolve once per quarter, then run the passenger market once.
import { getAircraftType, isWidebodyAircraft } from '../data/aircraft'
import { distanceKm } from '../data/cities'
import { CABIN_SEATS_BP, WEEKLY_BLOCK_MINUTES, WEEKS_PER_QUARTER } from '../data/constants'
import { fnv1a } from './rng'
import type { Airline, AircraftOperations, GameState, OperationsSummary, OwnedAircraft, Route } from './types'
import type { TripAllocation } from './queries'

export const WEEK_MINUTES = 7 * 24 * 60
export const QUARTER_MINUTES = WEEK_MINUTES * WEEKS_PER_QUARTER
export interface OperationsWeek { aircraftId:number; week:number; flightMinutes:number; unavailableMinutes:number; completed:number; covered:number; cancelled:number }
export const CHECK_INTERVAL = 8
export const crewFamily = (type: string): string =>
  type.startsWith('b747') ? '747' : type === 'b757' || type === 'b767' ? '757/767' : type
export const modernOperations = (state: GameState): boolean =>
  state.airlines.some((a) => a.operationsPolicy !== undefined)
export const tripMinutes = (type: string, route: Route): number => {
  const t = getAircraftType(type)
  return 2 * (Math.floor((distanceKm(route.from, route.to) * 60) / t.speedKmh) + t.turnaroundMin)
}
export function aircraftBase(airline: Airline, ac: OwnedAircraft): string {
  const routes = airline.routes.filter((r) => r.id === ac.routeId || r.id === ac.secondaryRouteId)
  if (!routes.length) return ac.operations?.base ?? airline.hq
  const cities = [routes[0]!.from, routes[0]!.to].filter((c) =>
    routes.every((r) => r.from === c || r.to === c),
  )
  return cities.includes(ac.operations?.base ?? '')
    ? ac.operations!.base
    : cities.includes(airline.hq)
      ? airline.hq
      : (cities[0] ?? airline.hq)
}
export function aircraftOperations(airline: Airline, ac: OwnedAircraft, turn: number): AircraftOperations {
  return (
    ac.operations ?? {
      base: aircraftBase(airline, ac),
      flightMinutes: ac.ageQuarters * 30000,
      cycles: ac.ageQuarters * 100,
      sinceCheckMinutes: (ac.ageQuarters % CHECK_INTERVAL) * 30000,
      sinceCheckCycles: (ac.ageQuarters % CHECK_INTERVAL) * 100,
      checkedTurn: turn - (ac.ageQuarters % CHECK_INTERVAL),
      storedQuarters: 0,
    }
  )
}
export function enableOperations(state: GameState): void {
  for (const a of state.airlines) {
    a.operationsPolicy ??= { reserveBp: 500, recovery: false }
    for (const ac of a.fleet) {
      ac.operations = aircraftOperations(a, ac, state.turn)
      // Convert any outstanding old grounding into a bounded repair, rather
      // than making an existing career wait out an obsolete 3-month outage.
      if ((ac.groundedUntil ?? 0) > state.turn)
        ac.operations.repairUntil = state.turn * QUARTER_MINUTES + 3 * 1440
      delete ac.groundedUntil
      delete ac.maintainedUntil
    }
  }
}
export function checkDueIn(airline: Airline, ac: OwnedAircraft, turn: number): number {
  const o = aircraftOperations(airline, ac, turn)
  if (o.sinceCheckMinutes >= 480000 || o.sinceCheckCycles >= 4000) return 0
  return Math.max(0, CHECK_INTERVAL - (turn - o.checkedTurn))
}
export function maintenanceQuote(ac: OwnedAircraft) {
  return { days: isWidebodyAircraft(ac.type) ? 10 : 7, cost: getAircraftType(ac.type).maintBase * 3 }
}
export function weeklyPlan(airline: Airline, onlyRoute?: Route): Map<number, TripAllocation[]> {
  const out = new Map<number, TripAllocation[]>()
  // Index assignments once; a whole-fleet plan is O(fleet + routes), not
  // a scan of every airframe for every route. Preserve original fleet order.
  const assigned = new Map<number, OwnedAircraft[]>()
  for (const ac of airline.fleet) {
    if (ac.reserve) continue
    for (const id of [ac.routeId, ac.secondaryRouteId]) {
      if (id === null || id === undefined || (onlyRoute && id !== onlyRoute.id)) continue
      const rows = assigned.get(id) ?? []
      rows.push(ac); assigned.set(id, rows)
    }
  }
  for (const route of onlyRoute ? [onlyRoute] : airline.routes) {
    let left = route.frequency
    const rows: TripAllocation[] = []
    for (const ac of assigned.get(route.id) ?? []) {
      const share = ac.secondaryRouteId === undefined ? 10000 : ac.routeId === route.id ? 6000 : 4000
      const budget = Math.floor(
        (WEEKLY_BLOCK_MINUTES * (10000 - (airline.operationsPolicy?.reserveBp ?? 0)) * share) / 100_000_000,
      )
      const trips = Math.min(left, Math.floor(budget / tripMinutes(ac.type, route)))
      left -= trips
      rows.push({
        aircraftId: ac.id,
        type: ac.type,
        cabin: ac.cabin,
        seats: Math.floor((getAircraftType(ac.type).seats * CABIN_SEATS_BP[ac.cabin - 1]!) / 10000),
        trips,
      })
    }
    out.set(route.id, rows)
  }
  return out
}
interface Interval {
  start: number
  end: number
}
export interface Disruption extends Interval {
  aircraftId: number
  cost: number
}
interface Job extends Interval {
  ac: OwnedAircraft
  route: Route
  minutes: number
  week: number
}
export interface OperationsResult {
  allocations: Map<number, TripAllocation[]>
  summary: OperationsSummary
  aircraft: Map<number, AircraftOperations>
}
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end
function unionMinutes(intervals: Interval[], start: number, end: number): number {
  let covered = 0,
    last = start
  for (const i of [...intervals].sort((a, b) => a.start - b.start)) {
    const s = Math.max(start, i.start, last),
      e = Math.min(end, i.end)
    if (e > s) covered += e - s
    last = Math.max(last, e)
  }
  return covered
}
export function resolveOperations(
  state: GameState,
  airline: Airline,
  mode: 'actual' | 'forecast' | 'adverse' = 'forecast',
  forced?: Disruption[],
  calendar?: OperationsWeek[],
): OperationsResult {
  const start = state.turn * QUARTER_MINUTES,
    end = start + QUARTER_MINUTES
  const plans = weeklyPlan(airline),
    routes = new Map(airline.routes.map((r) => [r.id, r]))
  const ownPlans = new Map<number, { route: Route; trips: number; minutes: number }[]>()
  for (const [id, rows] of plans) for (const row of rows) {
    if (row.trips <= 0) continue
    const own = ownPlans.get(row.aircraftId) ?? []
    own.push({ route: routes.get(id)!, trips: row.trips, minutes: tripMinutes(row.type, routes.get(id)!) })
    ownPlans.set(row.aircraftId, own)
  }
  const jobs: Job[] = [],
    unavailable = new Map<number, Interval[]>(),
    occupancy = new Map<number, Interval[][]>()
  const weeks = calendar ? new Map(airline.fleet.map(ac=>[ac.id,Array.from({length:13},(_,week):OperationsWeek=>({aircraftId:ac.id,week,flightMinutes:0,unavailableMinutes:0,completed:0,covered:0,cancelled:0}))])) : undefined
  const used = new Map<number, number[]>(),
    updated = new Map<number, AircraftOperations>()
  const summary: OperationsSummary = {
    turn: state.turn,
    scheduledTrips: 0,
    completedTrips: 0,
    disruptedTrips: 0,
    coveredTrips: 0,
    charterTrips: 0,
    cancelledTrips: 0,
    affectedPassengers: 0,
    repairCost: 0,
    checkCost: 0,
    recoveryCost: 0,
    availabilityBp: 10000,
    routes: airline.routes.map((r) => ({
      routeId: r.id,
      scheduled: r.frequency * 13,
      completed: 0,
      covered: 0,
      cancelled: 0,
      unservedSeats: 0,
    })),
    aircraft: [],
  }
  const routeStats = new Map(summary.routes.map((r) => [r.routeId, r]))
  const flightUsage = new Map<
    number,
    { minutes: number; cycles: number; afterMinutes: number; afterCycles: number }
  >()
  const effectiveChecks = new Map<number, number>()
  for (const ac of airline.fleet) {
    const o = { ...aircraftOperations(airline, ac, state.turn), base: aircraftBase(airline, ac) }
    updated.set(ac.id, o)
    used.set(ac.id, Array<number>(13).fill(0))
    flightUsage.set(ac.id, { minutes: 0, cycles: 0, afterMinutes: 0, afterCycles: 0 })
    const intervals: Interval[] = []
    if ((o.repairUntil ?? 0) > start) intervals.push({ start, end: o.repairUntil! })
    if (o.checkStart === undefined && checkDueIn(airline, ac, state.turn) === 0) {
      o.checkStart = start + (ac.id % 10) * WEEK_MINUTES
      o.checkEnd = o.checkStart + maintenanceQuote(ac).days * 1440
    }
    if (o.checkStart !== undefined && o.checkEnd !== undefined) {
      intervals.push({ start: o.checkStart, end: o.checkEnd })
      effectiveChecks.set(ac.id, o.checkEnd)
      if (o.checkStart >= start && o.checkStart < end) summary.checkCost += maintenanceQuote(ac).cost
    }
    const own = ownPlans.get(ac.id) ?? []
    const weeklyMinutes = own.reduce((n, a) => n + a.minutes * a.trips, 0)
    const incidents: Disruption[] = forced?.filter((i) => i.aircraftId === ac.id) ?? []
    if (forced === undefined && weeklyMinutes > 0) {
      if (mode === 'actual') {
        const overdue = Math.max(0, state.turn - o.checkedTurn - CHECK_INTERVAL)
        const risk = Math.min(
          3500,
          500 +
            ac.ageQuarters * 7 +
            Math.floor(o.sinceCheckMinutes / 1500) +
            Math.floor(o.sinceCheckCycles / 10) +
            overdue * 300,
        )
        if (fnv1a(`${state.seed}|${state.turn}|defect:${airline.id}:${ac.id}`) % 10000 < risk) {
          const roll = fnv1a(`${state.seed}|${state.turn}|severity:${airline.id}:${ac.id}`) % 10000
          const duration =
            roll < 8500
              ? 240 + (roll % 3) * 120
              : roll < 9800
                ? (1 + (roll % 3)) * 1440
                : (7 + (roll % 15)) * 1440
          const at =
            start + (fnv1a(`${state.seed}|${state.turn}|onset:${airline.id}:${ac.id}`) % QUARTER_MINUTES)
          if (!intervals.some((i) => at >= i.start && at < i.end))
            incidents.push({
              aircraftId: ac.id,
              start: at,
              end: at + duration,
              cost: Math.max(
                5,
                Math.floor(
                  (getAircraftType(ac.type).maintBase *
                    (duration > 4320 ? 30000 : duration > 720 ? 10000 : 1500)) /
                    10000,
                ),
              ),
            })
        }
      } else if (mode === 'adverse' && ac.id === airline.fleet.find((a) => a.routeId !== null)?.id)
        incidents.push({
          aircraftId: ac.id,
          start: start + 4 * WEEK_MINUTES,
          end: start + 4 * WEEK_MINUTES + 3 * 1440,
          cost: getAircraftType(ac.type).maintBase,
        })
    }
    for (const incident of incidents) {
      intervals.push(incident)
      summary.repairCost += incident.cost
      o.repairUntil = Math.max(o.repairUntil ?? 0, incident.end)
    }
    unavailable.set(ac.id, intervals)
    occupancy.set(ac.id, Array.from({ length: 13 }, () => []))
  }
  // Aggregate each unaffected airframe, even when another aircraft is in a
  // check. Materialize its preferred intervals only if dispatch tries to use
  // its spare hours, and only for that week. All hours are reserved up front.
  const aggregate = new Set(airline.fleet.filter(ac => !unavailable.get(ac.id)!.length).map(ac => ac.id))
  const weeklyMinutes = new Map(airline.fleet.map(ac => [ac.id, (ownPlans.get(ac.id) ?? []).reduce((n, row) => n + row.minutes * row.trips, 0)]))
  const departure = (ac: OwnedAircraft, minutes: number, prefix: number, week: number) => {
    const total = weeklyMinutes.get(ac.id)!
    return start + week * WEEK_MINUTES + Math.min((ac.id * 37) % 120,
      Math.floor(minutes * (WEEK_MINUTES - total) / Math.max(1, total))) +
      Math.floor(prefix * WEEK_MINUTES / Math.max(1, total))
  }
  const jobsInWeek = (ac: OwnedAircraft, week: number): Job[] => {
    const result: Job[] = []
    let prefix = 0
    for (const row of ownPlans.get(ac.id) ?? []) for (let i = 0; i < row.trips; i++) {
      const at = departure(ac, row.minutes, prefix, week)
      result.push({ ac, route: row.route, week, minutes: row.minutes, start: at, end: at + row.minutes })
      prefix += row.minutes
    }
    return result
  }
  const populated = new Set<string>()
  const preferredOccupancy = (ac: OwnedAircraft, week: number) => {
    const rows = occupancy.get(ac.id)![week]!, key = `${ac.id}:${week}`
    if (aggregate.has(ac.id) && !populated.has(key)) {
      rows.push(...jobsInWeek(ac, week)); populated.add(key)
    }
    return rows
  }
  let plannedTrips = 0
  for (const ac of airline.fleet) {
    plannedTrips += (ownPlans.get(ac.id) ?? []).reduce((n, row) => n + row.trips * 13, 0)
    if (aggregate.has(ac.id)) used.get(ac.id)!.fill(weeklyMinutes.get(ac.id)!)
    else for (let week = 0; week < 13; week++) jobs.push(...jobsInWeek(ac, week))
  }
  // Protect every unaffected preferred flight before using its aircraft as
  // recovery capacity. Cover must fit real time AND remaining weekly hours.
  for (const job of jobs)
    if (!unavailable.get(job.ac.id)!.some((i) => overlaps(i, job))) {
      occupancy.get(job.ac.id)![job.week]!.push(job)
      used.get(job.ac.id)![job.week]! += job.minutes
    }
  const candidates = [...airline.fleet].sort(
    (a, b) => Number(!!a.reserve) - Number(!!b.reserve) || a.id - b.id,
  )
  const candidateFamilies = new Map<string, OwnedAircraft[]>()
  const bases = new Map(candidates.map(ac => [ac.id, aircraftBase(airline, ac)]))
  for (const ac of candidates) {
    const family = crewFamily(ac.type), group = candidateFamilies.get(family) ?? []
    group.push(ac); candidateFamilies.set(family, group)
  }
  const allocations = new Map<number, TripAllocation[]>()
  const firstAllocation = new Map<string, { start: number; origin: number }>()
  const recordFirst = (routeId: number, aircraftId: number, at: number, origin: number) => {
    const key = `${routeId}:${aircraftId}`, prior = firstAllocation.get(key)
    if (!prior || at < prior.start || (at === prior.start && origin < prior.origin)) firstAllocation.set(key, { start: at, origin })
  }
  const add = (job: Job, ac: OwnedAircraft, minutes = job.minutes, charter = false) => {
    if (weeks) { const row = weeks.get(job.ac.id)![job.week]!; row.completed++; if (charter || ac.id !== job.ac.id) row.covered++ }
    const rows = allocations.get(job.route.id) ?? []
    const aircraftId = charter ? -ac.id : ac.id
    recordFirst(job.route.id, aircraftId, job.start, job.ac.id)
    let row = rows.find((r) => r.aircraftId === aircraftId)
    if (!row) {
      row = {
        aircraftId,
        type: ac.type,
        cabin: ac.cabin,
        seats: Math.floor((getAircraftType(ac.type).seats * CABIN_SEATS_BP[ac.cabin - 1]!) / 10000),
        trips: 0,
      }
      rows.push(row)
    }
    routeStats.get(job.route.id)!.unservedSeats +=
      Math.max(
        0,
        Math.floor((getAircraftType(job.ac.type).seats * CABIN_SEATS_BP[job.ac.cabin - 1]!) / 10000) -
          row.seats,
      ) * 2
    row.trips++
    allocations.set(job.route.id, rows)
    routeStats.get(job.route.id)!.completed++
    summary.completedTrips++
    if (!charter) {
      const u = flightUsage.get(ac.id)!
      const cycles = minutes > tripMinutes(ac.type, job.route) ? 4 : 2
      u.minutes += minutes
      u.cycles += cycles
      if (job.start >= (effectiveChecks.get(ac.id) ?? Infinity)) {
        u.afterMinutes += minutes
        u.afterCycles += cycles
      }
    }
  }
  for (const ac of airline.fleet) if (aggregate.has(ac.id)) {
    let prefix = 0
    for (const row of ownPlans.get(ac.id) ?? []) {
      recordFirst(row.route.id, ac.id, departure(ac, row.minutes, prefix, 0), ac.id)
      prefix += row.minutes * row.trips
      const count = row.trips * 13
      if (weeks) for (const week of weeks.get(ac.id)!) week.completed += row.trips
      const rows = allocations.get(row.route.id) ?? []
      rows.push({ aircraftId: ac.id, type: ac.type, cabin: ac.cabin,
        seats: Math.floor(getAircraftType(ac.type).seats * CABIN_SEATS_BP[ac.cabin - 1]! / 10000), trips: count })
      allocations.set(row.route.id, rows)
      routeStats.get(row.route.id)!.completed += count
      summary.completedTrips += count
      const u = flightUsage.get(ac.id)!
      u.minutes += row.minutes * count; u.cycles += count * 2
    }
  }
  jobs.sort((a, b) => a.start - b.start || a.ac.id - b.ac.id || a.route.id - b.route.id)
  for (const job of jobs) {
    if (!unavailable.get(job.ac.id)!.some((i) => overlaps(i, job))) {
      add(job, job.ac)
      continue
    }
    summary.disruptedTrips++
    let covered = false
    // Spare hours on scheduled fleet first; dedicated standby second.
    for (const donor of candidateFamilies.get(crewFamily(job.ac.type)) ?? []) {
      if (donor.id === job.ac.id || crewFamily(donor.type) !== crewFamily(job.ac.type)) continue
      const t = getAircraftType(donor.type),
        km = distanceKm(job.route.from, job.route.to)
      if (km > t.rangeKm) continue
      const base = bases.get(donor.id)!,
        ferryKm =
          base === job.route.from || base === job.route.to
            ? 0
            : Math.min(distanceKm(base, job.route.from), distanceKm(base, job.route.to))
      if (ferryKm > Math.min(1000, t.rangeKm)) continue
      const ferry = ferryKm === 0 ? 0 : Math.floor((ferryKm * 60) / t.speedKmh) + t.turnaroundMin
      const minutes = tripMinutes(donor.type, job.route) + 2 * ferry
      const span = { start: job.start - ferry, end: job.start + tripMinutes(donor.type, job.route) + ferry }
      if (
        span.start < start + job.week * WEEK_MINUTES ||
        span.end > start + (job.week + 1) * WEEK_MINUTES ||
        used.get(donor.id)![job.week]! + minutes > WEEKLY_BLOCK_MINUTES
      )
        continue
      if (
        unavailable.get(donor.id)!.some((i) => overlaps(i, span)) ||
        preferredOccupancy(donor, job.week).some((i) => overlaps(i, span))
      )
        continue
      occupancy.get(donor.id)![job.week]!.push(span)
      used.get(donor.id)![job.week]! += minutes
      add(job, donor, minutes)
      summary.coveredTrips++
      routeStats.get(job.route.id)!.covered++
      if (ferry > 0) summary.recoveryCost += Math.max(1, Math.floor((ferryKm * t.fuelPerKm * 2) / 1000))
      covered = true
      break
    }
    if (
      !covered &&
      airline.operationsPolicy?.recovery &&
      summary.charterTrips < Math.floor(plannedTrips / 10)
    ) {
      add(job, job.ac, job.minutes, true)
      summary.charterTrips++
      summary.coveredTrips++
      routeStats.get(job.route.id)!.covered++
      covered = true
      summary.recoveryCost += Math.max(
        8,
        Math.floor(
          getAircraftType(job.ac.type).price / 1500 +
            (distanceKm(job.route.from, job.route.to) * getAircraftType(job.ac.type).fuelPerKm) / 1500,
        ),
      )
    }
    if (!covered) {
      if (weeks) weeks.get(job.ac.id)![job.week]!.cancelled++
      routeStats.get(job.route.id)!.unservedSeats +=
        Math.floor((getAircraftType(job.ac.type).seats * CABIN_SEATS_BP[job.ac.cabin - 1]!) / 10000) * 2
    }
  }
  // Aggregation commutes with dispatch counts; preserve the original order
  // of first flown trips for downstream integer cost accumulation.
  for (const [id, rows] of allocations) rows.sort((a, b) => {
    const one = firstAllocation.get(`${id}:${a.aircraftId}`)!, two = firstAllocation.get(`${id}:${b.aircraftId}`)!
    return one.start - two.start || one.origin - two.origin
  })
  let unavailableTotal = 0
  for (const ac of airline.fleet) {
    const o = updated.get(ac.id)!,
      u = flightUsage.get(ac.id)!,
      blocked = unionMinutes(unavailable.get(ac.id)!, start, end)
    unavailableTotal += blocked
    if (weeks && calendar) for (const row of weeks.get(ac.id)!) {
      row.flightMinutes = used.get(ac.id)![row.week]!
      row.unavailableMinutes = unionMinutes(unavailable.get(ac.id)!, start+row.week*WEEK_MINUTES, start+(row.week+1)*WEEK_MINUTES)
      calendar.push(row)
    }
    o.flightMinutes += u.minutes
    o.cycles += u.cycles
    if ((o.checkEnd ?? Infinity) <= end) {
      o.checkedTurn = Math.floor(o.checkEnd! / QUARTER_MINUTES)
      o.sinceCheckMinutes = u.afterMinutes
      o.sinceCheckCycles = u.afterCycles
      delete o.checkStart
      delete o.checkEnd
    } else {
      o.sinceCheckMinutes += u.minutes
      o.sinceCheckCycles += u.cycles
    }
    if ((o.repairUntil ?? 0) <= end) delete o.repairUntil
    if (u.minutes === 0) o.storedQuarters++
    summary.aircraft.push({
      aircraftId: ac.id,
      unavailableMinutes: blocked,
      flightMinutes: u.minutes,
      cycles: u.cycles,
      spareMinutes: Math.max(
        0,
        WEEKLY_BLOCK_MINUTES * 13 - u.minutes - Math.floor((blocked * WEEKLY_BLOCK_MINUTES) / WEEK_MINUTES),
      ),
    })
  }
  for (const r of summary.routes) {
    r.cancelled = Math.max(0, r.scheduled - r.completed)
    summary.scheduledTrips += r.scheduled
    summary.cancelledTrips += r.cancelled
  }
  summary.availabilityBp = airline.fleet.length
    ? 10000 - Math.floor((unavailableTotal * 10000) / (airline.fleet.length * QUARTER_MINUTES))
    : 10000
  return { allocations, summary, aircraft: updated }
}
