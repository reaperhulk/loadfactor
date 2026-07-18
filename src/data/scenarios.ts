export interface AirlineSetup {
  name: string
  hq: string // city id
  cash: number // $k
  hqSlots: number
  // Starting foothold slots beyond the HQ — without these no route could
  // open on turn 1 (routes need a slot at both endpoints).
  extraSlots: Readonly<Record<string, number>>
  starterFleet: readonly string[] // aircraft type ids
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
      },
      {
        name: 'Pacific Crown',
        hq: 'HND',
        cash: 18000,
        hqSlots: 8,
        extraSlots: { HKG: 4, SEL: 2, SIN: 2 },
        starterFleet: ['meridian80', 'meridian80'],
      },
    ],
    targetNetWorth: 300_000,
  },
]

const byId = new Map(SCENARIOS.map((s) => [s.id, s]))

export function getScenario(id: string): Scenario {
  const s = byId.get(id)
  if (!s) throw new Error(`unknown scenario ${id}`)
  return s
}
