// The fleet catalog: real airframes spanning the airliner generations, gated
// by availability years so fleet renewal is a strategic drumbeat across a
// scenario (PLAN.md §2.3). Stats are gameplay-tuned, not spec sheets — each
// type keeps its real-world character (role, era, relative size and legs)
// inside the game's balance envelope.

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
    id: 'cv240',
    name: 'Convair 240',
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
    id: 'caravelle',
    name: 'Sud Caravelle',
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
    id: 'b727',
    name: 'Boeing 727',
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
    id: 'b737_200',
    name: 'Boeing 737-200',
    seats: 110,
    rangeKm: 3700,
    speedKmh: 850,
    turnaroundMin: 40,
    price: 9500,
    fuelPerKm: 4,
    maintBase: 95,
    deliveryQuarters: 2,
    availableFrom: 1968,
    availableTo: 1988,
  },
  {
    id: 'dc8_62',
    name: 'DC-8 Super 62',
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
    id: 'b747_100',
    name: 'Boeing 747-100',
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
    id: 'dc10_30',
    name: 'DC-10-30',
    seats: 250,
    rangeKm: 9000,
    speedKmh: 890,
    turnaroundMin: 65,
    price: 30000,
    fuelPerKm: 9,
    maintBase: 250,
    deliveryQuarters: 3,
    availableFrom: 1971,
    availableTo: 1989,
  },
  {
    id: 'b747_200',
    name: 'Boeing 747-200B',
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
    id: 'b767',
    name: 'Boeing 767',
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
    id: 'b757',
    name: 'Boeing 757-200',
    seats: 200,
    rangeKm: 7200,
    speedKmh: 850,
    turnaroundMin: 45,
    price: 22000,
    fuelPerKm: 4,
    maintBase: 140,
    deliveryQuarters: 2,
    availableFrom: 1983,
    availableTo: 2004,
  },
  {
    id: 'a320',
    name: 'Airbus A320',
    seats: 150,
    rangeKm: 5600,
    speedKmh: 840,
    turnaroundMin: 40,
    price: 15500,
    fuelPerKm: 3,
    maintBase: 120,
    deliveryQuarters: 2,
    availableFrom: 1988,
    availableTo: 2035,
  },
  {
    id: 'md11',
    name: 'MD-11',
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
  {
    id: 'a340',
    name: 'Airbus A340-300',
    seats: 295,
    rangeKm: 12400,
    speedKmh: 880,
    turnaroundMin: 75,
    price: 42000,
    fuelPerKm: 7,
    maintBase: 270,
    deliveryQuarters: 3,
    availableFrom: 1993,
    availableTo: 2011,
  },
  {
    id: 'b777',
    name: 'Boeing 777-200',
    seats: 310,
    rangeKm: 9700,
    speedKmh: 905,
    turnaroundMin: 70,
    price: 46000,
    fuelPerKm: 6,
    maintBase: 240,
    deliveryQuarters: 3,
    availableFrom: 1995,
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
