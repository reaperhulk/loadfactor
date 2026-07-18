// The fleet catalog. Fictional-but-plausible analogs of real airliner
// generations, gated by availability years so fleet renewal is a strategic
// drumbeat across a scenario (PLAN.md §2.3).

export interface AircraftType {
  id: string
  name: string
  seats: number
  rangeKm: number
  speedKmh: number
  turnaroundMin: number
  price: number // $k
  fuelPerKm: number // $ per km at fuel index 10000
  maintBase: number // $k per quarter, before age escalation
  deliveryQuarters: number
  availableFrom: number // first year on sale
  availableTo: number // last year on sale (existing airframes keep flying)
}

export const AIRCRAFT: readonly AircraftType[] = [
  {
    id: 'pelican40',
    name: 'Pelican 40',
    seats: 40,
    rangeKm: 1600,
    speedKmh: 480,
    turnaroundMin: 35,
    price: 2400,
    fuelPerKm: 2,
    maintBase: 35,
    deliveryQuarters: 1,
    availableFrom: 1950,
    availableTo: 1974,
  },
  {
    id: 'meridian80',
    name: 'Meridian 80',
    seats: 80,
    rangeKm: 3000,
    speedKmh: 800,
    turnaroundMin: 45,
    price: 6800,
    fuelPerKm: 4,
    maintBase: 80,
    deliveryQuarters: 2,
    availableFrom: 1957,
    availableTo: 1982,
  },
  {
    id: 'zephyr120',
    name: 'Zephyr 120',
    seats: 120,
    rangeKm: 4300,
    speedKmh: 850,
    turnaroundMin: 50,
    price: 11000,
    fuelPerKm: 5,
    maintBase: 120,
    deliveryQuarters: 2,
    availableFrom: 1963,
    availableTo: 1992,
  },
  {
    id: 'corsair160',
    name: 'Corsair 160',
    seats: 160,
    rangeKm: 7200,
    speedKmh: 880,
    turnaroundMin: 55,
    price: 17000,
    fuelPerKm: 6,
    maintBase: 165,
    deliveryQuarters: 3,
    availableFrom: 1967,
    availableTo: 1998,
  },
  {
    id: 'atlas320',
    name: 'Atlas 320',
    seats: 320,
    rangeKm: 9800,
    speedKmh: 900,
    turnaroundMin: 75,
    price: 42000,
    fuelPerKm: 11,
    maintBase: 320,
    deliveryQuarters: 3,
    availableFrom: 1970,
    availableTo: 2010,
  },
  {
    id: 'titan420',
    name: 'Titan 420',
    seats: 420,
    rangeKm: 11800,
    speedKmh: 910,
    turnaroundMin: 90,
    price: 60000,
    fuelPerKm: 14,
    maintBase: 430,
    deliveryQuarters: 4,
    availableFrom: 1972,
    availableTo: 2020,
  },
  {
    id: 'aurora180',
    name: 'Aurora 180',
    seats: 180,
    rangeKm: 6800,
    speedKmh: 870,
    turnaroundMin: 50,
    price: 26000,
    fuelPerKm: 4,
    maintBase: 150,
    deliveryQuarters: 2,
    availableFrom: 1984,
    availableTo: 2035,
  },
  {
    id: 'albatross260',
    name: 'Albatross 260',
    seats: 260,
    rangeKm: 12500,
    speedKmh: 905,
    turnaroundMin: 70,
    price: 38000,
    fuelPerKm: 6,
    maintBase: 260,
    deliveryQuarters: 3,
    availableFrom: 1991,
    availableTo: 2035,
  },
]

const byId = new Map(AIRCRAFT.map((a) => [a.id, a]))

export function getAircraftType(id: string): AircraftType {
  const a = byId.get(id)
  if (!a) throw new Error(`unknown aircraft type ${id}`)
  return a
}

export function isAircraftType(id: string): boolean {
  return byId.has(id)
}

export function typesOnSale(year: number): readonly AircraftType[] {
  return AIRCRAFT.filter((a) => year >= a.availableFrom && year <= a.availableTo)
}
