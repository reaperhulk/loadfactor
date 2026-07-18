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

export interface Scenario {
  id: string
  name: string
  description: string
  startYear: number
  quarters: number
  player: AirlineSetup
  rivals: readonly AirlineSetup[]
  // Scored when the final quarter resolves: the player wins by finishing #1
  // in net worth among the airlines AND clearing this qualifying floor ($k).
  targetNetWorth: number
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
      'net worth — and be worth at least $300M.',
    startYear: 1960,
    quarters: 80,
    player: {
      name: 'Meridian Air',
      hq: 'JFK',
      cash: 18000,
      hqSlots: 8,
      extraSlots: { ORD: 4, MIA: 2, YYZ: 2 },
      starterFleet: ['meridian80', 'meridian80'],
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
        starterFleet: ['meridian80', 'meridian80'],
        personality: 'premium',
      },
      {
        name: 'Pacific Crown',
        hq: 'HND',
        cash: 18000,
        hqSlots: 8,
        extraSlots: { HKG: 4, SEL: 2, SIN: 2 },
        starterFleet: ['meridian80', 'meridian80'],
        personality: 'fortress',
      },
    ],
    targetNetWorth: 300_000,
  },
  {
    id: 'oil_crisis',
    name: 'The Oil Crisis',
    description:
      'London, 1972. Widebodies are landing just as the fuel bill explodes, ' +
      'and the discounters smell blood. Survive the shocks and finish 1987 ' +
      'as the #1 airline, worth at least $250M.',
    startYear: 1972,
    quarters: 60,
    player: {
      name: 'Trans Europa',
      hq: 'LHR',
      cash: 25000,
      hqSlots: 8,
      extraSlots: { MAD: 2, FCO: 2, IST: 2 },
      starterFleet: ['zephyr120', 'zephyr120'],
    },
    rivals: [
      {
        name: 'Atlantic Global',
        hq: 'JFK',
        cash: 25000,
        hqSlots: 8,
        extraSlots: { ORD: 2, MIA: 2, BOS: 2 },
        starterFleet: ['zephyr120', 'zephyr120'],
        personality: 'price_war',
      },
      {
        name: 'Nippon Star',
        hq: 'HND',
        cash: 25000,
        hqSlots: 8,
        extraSlots: { KIX: 2, SEL: 2, HKG: 2 },
        starterFleet: ['zephyr120', 'zephyr120'],
        personality: 'fortress',
      },
    ],
    targetNetWorth: 250_000,
    eventWeightMult: { oil_shock: 4, recession: 2, boom: 0.5 },
  },
  {
    id: 'deregulation',
    name: 'Deregulation',
    description:
      'Los Angeles, 1985. The rules are gone, the twins are efficient, and ' +
      'three rivals want your gates. Out-fly a price war and finish 2000 as ' +
      'the #1 airline, worth at least $400M.',
    startYear: 1985,
    quarters: 60,
    player: {
      name: 'Pacific West',
      hq: 'LAX',
      cash: 30000,
      hqSlots: 8,
      extraSlots: { SFO: 2, SEA: 2, DEN: 2 },
      starterFleet: ['aurora180', 'aurora180'],
    },
    rivals: [
      {
        name: 'Liberty Air',
        hq: 'JFK',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { ATL: 2, ORD: 2, BOS: 2 },
        starterFleet: ['aurora180', 'aurora180'],
        personality: 'price_war',
      },
      {
        name: 'Crown Pacific',
        hq: 'HND',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { KIX: 2, SEL: 2, TPE: 2 },
        starterFleet: ['aurora180', 'aurora180'],
        personality: 'fortress',
      },
      {
        name: 'EuroJet',
        hq: 'LHR',
        cash: 30000,
        hqSlots: 8,
        extraSlots: { MAD: 2, FCO: 2, ARN: 2 },
        starterFleet: ['aurora180', 'aurora180'],
        personality: 'premium',
      },
    ],
    targetNetWorth: 400_000,
    eventWeightMult: { boom: 2, tourism_wave: 2 },
  },
]

const byId = new Map(SCENARIOS.map((s) => [s.id, s]))

export function getScenario(id: string): Scenario {
  const s = byId.get(id)
  if (!s) throw new Error(`unknown scenario ${id}`)
  return s
}
