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
  // Objective: reach the target net worth ($k) before the final quarter.
  targetNetWorth: number
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'jet_age',
    name: 'The Jet Age',
    description:
      'New York, 1960. The jets are here, the Atlantic is the prize, and two ' +
      'rivals are racing you for every slot. Build a $300M airline by 1980.',
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
        extraSlots: { CDG: 4, FRA: 2, AMS: 2 },
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
