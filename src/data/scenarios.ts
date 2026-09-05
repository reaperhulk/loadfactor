export type RivalPersonality = 'balanced' | 'price_war' | 'premium' | 'fortress'

export interface AirlineSetup {
  name: string
  hq: string // city id
  cash: number // $k
  hqSlots: number
  // Starting foothold slots beyond the HQ — without these no route could
  // open on turn 1 (routes need a slot at both endpoints).
  extraSlots: Readonly<Record<string, number>>
  starterFleet: readonly string[] // aircraft type ids
  personality?: RivalPersonality // rivals only; defaults to 'balanced'
}

// What an era actually asks of you (PLAN.md §2.4). Five scenarios that all
// score net worth are five copies of one game; each era now names its own
// measure of a great airline, so the optimal play differs era to era.
export type ObjectiveKind =
  | 'netWorth' // classic: build the most valuable airline
  | 'profit' // cumulative profit — who actually made money through the era
  | 'pax' // cumulative passengers flown — the fight for the flying public
  | 'transfer' // cumulative connecting passengers — the megahub game
  | 'loadFactor' // seats actually filled across the era — the efficiency war

export interface ScenarioObjective {
  minimumPax?: number
  minimumRoutes?: number
  minimumLongHaul?: number
  kind: ObjectiveKind
  // The qualifying bar: a floor for higher-is-better metrics, a ceiling for
  // costPerSeat. Being #1 is never enough on its own.
  target: number
  higherIsBetter: boolean
  label: string // axis name, e.g. "cumulative profit"
  unit: 'money' | 'count' | 'rate'
  blurb: string // one line telling the player how to win this era
}

export interface ScenarioRules {
  blurb: string
  longHaulDemandBp?: number
  hedgePremiumBp?: number
  playerFuelBp?: number
  discountDemandBp?: number
  connectionDemandBp?: number
  routeOverheadBp?: number
}

export interface Scenario {
  short?: boolean
  startingRoutes?: readonly { from: string; to: string; aircraftIndex: number; frequency: number }[]
  startingAgeQuarters?: number
  startingDebtK?: number
  startingFuelBp?: number
  id: string
  name: string
  description: string
  startYear: number
  quarters: number
  player: AirlineSetup
  rivals: readonly AirlineSetup[]
  // The era's own victory measure. Scored when the final quarter resolves:
  // finish #1 among the live airlines on this metric AND clear its bar.
  objective: ScenarioObjective
  // Economic scale reference for the era: the runaway cap and the UI's
  // "how big is big here" both read this. Equals the objective target for
  // net-worth eras.
  targetNetWorth: number
  // A small, explicit rules twist makes the era change how a network should
  // be built, not merely which number is scored at the end.
  rules: ScenarioRules
  // Era flavor: multipliers on world-event draw weights (e.g. oil_shock ×4
  // in the Oil Crisis scenario). Unlisted events keep weight ×1.
  eventWeightMult?: Readonly<Record<string, number>>
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'jet_age',
    name: 'The Jet Age',
    description:
      'New York, 1960. The jets are here, the Atlantic is the prize, and two ' +
      'rivals are racing you for every slot. Finish 1980 as the #1 airline by ' +
      'net worth — and be worth at least $550M.',
    startYear: 1960,
    quarters: 80,
    player: {
      name: 'Meridian Air',
      hq: 'JFK',
      cash: 18000,
      hqSlots: 8,
      extraSlots: { ORD: 4, MIA: 2, YYZ: 2 },
      starterFleet: ['caravelle', 'caravelle'],
    },
    rivals: [
      {
        name: 'Albion Airways',
        hq: 'LHR',
        cash: 18000,
        hqSlots: 8,
        // Footholds at medium-haul distances — LHR-CDG/AMS sit in the
        // ground-competition demand band and would starve the AI.
        extraSlots: { FRA: 2, MAD: 2, FCO: 2 },
        starterFleet: ['caravelle', 'caravelle'],
        personality: 'premium',
      },
      {
        name: 'Pacific Crown',
        hq: 'HND',
        cash: 18000,
        hqSlots: 8,
        extraSlots: { HKG: 4, SEL: 2, SIN: 2 },
        starterFleet: ['caravelle', 'caravelle'],
        personality: 'fortress',
      },
      {
        name: 'Condor Sur',
        hq: 'GRU',
        cash: 18000,
        hqSlots: 8,
        extraSlots: { EZE: 2, BOG: 2, SCL: 2 },
        starterFleet: ['caravelle', 'caravelle'],
        personality: 'price_war',
      },
    ],
    objective: {
      kind: 'netWorth',
      target: 550_000,
      higherIsBetter: true,
      label: 'net worth',
      unit: 'money',
      blurb: 'Build the most valuable airline in the sky by 1980.',
    },
    targetNetWorth: 550_000,
    rules: {
      blurb: 'Jet prestige: demand on routes over 4,000 km is 10% higher.',
      longHaulDemandBp: 11000,
    },
  },
  {
    id: 'oil_crisis',
    name: 'The Oil Crisis',
    description:
      'London, 1972. Widebodies are landing just as the fuel bill explodes, ' +
      'and the discounters smell blood. Survive the shocks and finish 1987 ' +
      'with the most cumulative profit.',
    startYear: 1972,
    quarters: 60,
    player: {
      name: 'Trans Europa',
      hq: 'LHR',
      cash: 25000,
      hqSlots: 8,
      extraSlots: { MAD: 2, FCO: 2, IST: 2 },
      starterFleet: ['b727', 'b727'],
    },
    rivals: [
      {
        name: 'Atlantic Global',
        hq: 'JFK',
        cash: 25000,
        hqSlots: 8,
        extraSlots: { ORD: 2, MIA: 2, BOS: 2 },
        starterFleet: ['b727', 'b727'],
        personality: 'price_war',
      },
      {
        name: 'Nippon Star',
        hq: 'HND',
        cash: 25000,
        hqSlots: 8,
        extraSlots: { KIX: 2, SEL: 2, HKG: 2 },
        starterFleet: ['b727', 'b727'],
        personality: 'fortress',
      },
    ],
    objective: {
      kind: 'profit',
      target: 1_800_000,
      higherIsBetter: true,
      label: 'cumulative profit',
      unit: 'money',
      blurb: 'Anyone can fly jets in a boom. Bank the most money ACROSS the crisis — every quarter of profit counts, every loss claws it back.',
    },
    targetNetWorth: 400_000,
    rules: {
      blurb: 'Crisis desk: supply contracts cut your fuel bill 3%, and hedge premiums are 40% cheaper.',
      hedgePremiumBp: 6000,
      playerFuelBp: 9700,
    },
    eventWeightMult: { oil_shock: 4, recession: 2, boom: 0.5 },
  },
  {
    id: 'deregulation',
    name: 'Deregulation',
    description:
      'Los Angeles, 1985. The rules are gone, the twins are efficient, and ' +
      'three rivals want your gates. Out-fly the price war and carry the most ' +
      'passengers by 2000.',
    startYear: 1985,
    quarters: 60,
    player: {
      name: 'Pacific West',
      hq: 'LAX',
      cash: 30000,
      hqSlots: 8,
      extraSlots: { SFO: 2, SEA: 2, DEN: 2 },
      starterFleet: ['b767', 'b767'],
    },
    rivals: [
      {
        name: 'Liberty Air',
        hq: 'JFK',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { ATL: 2, ORD: 2, BOS: 2 },
        starterFleet: ['b767', 'b767'],
        personality: 'price_war',
      },
      {
        name: 'Crown Pacific',
        hq: 'HND',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { KIX: 2, SEL: 2, TPE: 2 },
        starterFleet: ['b767', 'b767'],
        personality: 'fortress',
      },
      {
        name: 'EuroJet',
        hq: 'LHR',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { MAD: 2, FCO: 2, ARN: 2 },
        starterFleet: ['b767', 'b767'],
        personality: 'premium',
      },
    ],
    objective: {
      kind: 'pax',
      target: 22_000_000,
      higherIsBetter: true,
      label: 'passengers flown',
      unit: 'count',
      blurb: 'The rules are gone and the public is the prize: carry more passengers than anyone else by 2000.',
    },
    targetNetWorth: 600_000,
    rules: {
      blurb: 'Fare freedom: discounted routes attract 5% more passengers.',
      discountDemandBp: 10500,
    },
    eventWeightMult: { boom: 2, tourism_wave: 2 },
  },
  {
    id: 'open_skies',
    name: 'Open Skies',
    description:
      'Singapore, 1995. Borders open, the big twins fly anywhere, and every ' +
      'megahub wants your passengers. Build the strongest connecting network ' +
      'and carry the most transfer traffic by 2010.',
    startYear: 1995,
    quarters: 60,
    player: {
      name: 'Meridian Pacific',
      hq: 'SIN',
      cash: 35000,
      hqSlots: 8,
      extraSlots: { HKG: 2, BKK: 2, KUL: 2 },
      starterFleet: ['a320', 'a320'],
    },
    rivals: [
      {
        name: 'Gulf Crown',
        hq: 'DXB',
        cash: 35000,
        hqSlots: 8,
        extraSlots: { BOM: 2, CAI: 2, IST: 2 },
        starterFleet: ['a320', 'a320'],
        personality: 'premium',
      },
      {
        name: 'Liberty Global',
        hq: 'JFK',
        cash: 35000,
        hqSlots: 8,
        extraSlots: { ORD: 2, LAX: 2, MIA: 2 },
        starterFleet: ['b767', 'b767'],
        personality: 'balanced',
      },
      {
        name: 'EuroConnect',
        hq: 'FRA',
        cash: 35000,
        hqSlots: 8,
        extraSlots: { MAD: 2, FCO: 2, ARN: 2 },
        starterFleet: ['a320', 'a320'],
        personality: 'price_war',
      },
    ],
    objective: {
      kind: 'transfer',
      target: 5_000_000,
      higherIsBetter: true,
      label: 'connecting passengers',
      unit: 'count',
      blurb: 'Megahub or nothing: win on CONNECTING passengers — travellers who change planes inside your network.',
    },
    targetNetWorth: 750_000,
    rules: {
      blurb: 'Open-skies rights: your hubs attract 10% more connecting travellers.',
      connectionDemandBp: 11000,
    },
    eventWeightMult: { boom: 2, tourism_wave: 2, conflict: 1.5 },
  },
  {
    id: 'lcc_wars',
    name: 'Low-Cost Wars',
    description:
      'Barcelona, 2005. Fuel spikes, slumps ground whole fleets, and every ' +
      'discounter is packing A320s nose to tail. Out-lean them all and finish ' +
      '2020 with the highest lifetime load factor.',
    startYear: 2005,
    quarters: 60,
    player: {
      name: 'Sol Express',
      hq: 'BCN',
      cash: 40000,
      hqSlots: 8,
      extraSlots: { LHR: 2, FCO: 2, IST: 2 },
      starterFleet: ['a320', 'a320'],
    },
    rivals: [
      {
        name: 'Vega Blue',
        hq: 'LAS',
        cash: 40000,
        hqSlots: 8,
        extraSlots: { PHX: 2, DEN: 2, SAN: 2 },
        starterFleet: ['a320', 'a320'],
        personality: 'price_war',
      },
      {
        name: 'Archipelago Air',
        hq: 'KUL',
        cash: 40000,
        hqSlots: 8,
        extraSlots: { SIN: 2, BKK: 2, CGK: 2 },
        starterFleet: ['a320', 'a320'],
        personality: 'price_war',
      },
      {
        name: 'Kaiser Luft',
        hq: 'FRA',
        cash: 40000,
        hqSlots: 8,
        extraSlots: { MUC: 2, VIE: 2, ZRH: 2 },
        starterFleet: ['b777', 'a320'],
        personality: 'premium',
      },
    ],
    objective: {
      kind: 'loadFactor',
      target: 7600,
      higherIsBetter: true,
      label: 'lifetime load factor',
      unit: 'rate',
      blurb: 'Fill the seats. Every empty seat you fly is money burned — win on the share of seats actually sold across the era.',
    },
    targetNetWorth: 750_000,
    rules: {
      blurb: 'Lean operations: quadratic network-management overhead is 30% lower.',
      routeOverheadBp: 7000,
    },
    eventWeightMult: { travel_slump: 3, oil_shock: 2, alliance_boom: 2, boom: 0.75 },
  },
]

// Focused board mandates: the same engine with a decision-sized horizon.
export const SHORT_SCENARIOS: readonly Scenario[] = [
  {
    ...SCENARIOS[0]!, id: 'rescue', name: 'The Turnaround', short: true,
    description: 'An aging fleet, a thin treasury and four years to restore profitability. Repair, replace, or shrink?',
    quarters: 16, startingAgeQuarters: 44, startingDebtK: 8000,
    player: { ...SCENARIOS[0]!.player, cash: 12000 },
    objective: { kind: 'profit', target: 20000, higherIsBetter: true, label: 'turnaround profit', unit: 'money', minimumPax: 300000,
      blurb: 'Earn $20M cumulative profit and carry 300,000 passengers in four years.' },
    targetNetWorth: 150000,
  },
  {
    ...SCENARIOS[0]!, id: 'atlantic', name: 'Atlantic Crossing', short: true,
    description: 'London, 1968. Build a transatlantic operation before the five-year mandate expires.',
    startYear: 1968, quarters: 20,
    rivals: [{ ...SCENARIOS[0]!.rivals[0]!, hq: 'JFK', extraSlots: { LHR: 2, ORD: 2, MIA: 2 }, starterFleet: ['dc8_62', 'caravelle'] }, ...SCENARIOS[0]!.rivals.slice(1)],
    player: { name: 'Northstar Atlantic', hq: 'LHR', hqSlots: 8, cash: 30000, extraSlots: { JFK: 3, BOS: 2, MAD: 2 }, starterFleet: ['dc8_62', 'caravelle'] },
    objective: { kind: 'pax', target: 1500000, higherIsBetter: true, label: 'passengers carried', unit: 'count', minimumLongHaul: 1,
      blurb: 'Carry 1.5M passengers and finish with an active route of at least 4,500km.' },
    targetNetWorth: 250000,
  },
  {
    ...SCENARIOS[1]!, id: 'fuel_crunch', name: 'Sixteen Quarters of Oil', short: true,
    description: 'Fuel starts at 160% of normal. Keep your airline profitable through a four-year energy squeeze.',
    quarters: 16, startingFuelBp: 16000,
    objective: { kind: 'profit', target: 25000, higherIsBetter: true, label: 'crisis profit', unit: 'money', minimumPax: 500000,
      blurb: 'Earn $25M cumulative profit and carry half a million passengers despite costly fuel.' },
    targetNetWorth: 200000,
  },
  {
    ...SCENARIOS[3]!, id: 'hub_defense', name: 'Fortress Hub', short: true,
    player: { ...SCENARIOS[3]!.player, name: 'Meridian Gulf', hq: 'DXB', extraSlots: { IST: 2, BOM: 2, DEL: 2 }, starterFleet: ['a320', 'b767', 'b767'] },
    rivals: [{ ...SCENARIOS[3]!.rivals[0]!, hq: 'SIN', extraSlots: { HKG: 2, BKK: 2, KUL: 2 } }, ...SCENARIOS[3]!.rivals.slice(1)],
    startingRoutes: [{ from: 'DXB', to: 'IST', aircraftIndex: 0, frequency: 8 }, { from: 'DXB', to: 'BOM', aircraftIndex: 1, frequency: 8 }, { from: 'DXB', to: 'DEL', aircraftIndex: 2, frequency: 8 }],
    description: 'Six years to make your hub indispensable. Coordinate connections, protect capacity and outgrow rival networks.',
    quarters: 24,
    objective: { kind: 'transfer', target: 1200000, higherIsBetter: true, label: 'connecting boardings', unit: 'count', minimumRoutes: 3,
      blurb: 'Carry 1.2M connecting boardings and retain at least three active routes.' },
    targetNetWorth: 350000,
  },
]
export const ALL_SCENARIOS = [...SCENARIOS, ...SHORT_SCENARIOS]

const byId = new Map(ALL_SCENARIOS.map((s) => [s.id, s]))

export function getScenario(id: string): Scenario {
  const s = byId.get(id)
  if (!s) throw new Error(`unknown scenario ${id}`)
  return s
}
