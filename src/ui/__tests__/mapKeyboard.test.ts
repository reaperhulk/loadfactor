import { describe, expect, it } from 'vitest'
import { nearestInDirection } from '../map/keyboard'

// A little cross of sites around the origin, plus decoys off-axis.
const sites = [
  { id: 'E1', x: 10, y: 0 },
  { id: 'E2', x: 30, y: 1 },
  { id: 'NE', x: 8, y: -7 },
  { id: 'N', x: 0, y: -20 },
  { id: 'S', x: 1, y: 15 },
  { id: 'W', x: -12, y: 2 },
]
const origin = { x: 0, y: 0 }

describe('keyboard travel between airports', () => {
  it('hops to the nearest site straight ahead', () => {
    expect(nearestInDirection(origin, sites, 'right')).toBe('E1')
    expect(nearestInDirection(origin, sites, 'left')).toBe('W')
    expect(nearestInDirection(origin, sites, 'down')).toBe('S')
  })

  it('prefers straight ahead to a closer site off to the side', () => {
    // NE is nearer than N, but mostly east of the origin.
    expect(nearestInDirection(origin, sites, 'up')).toBe('N')
  })

  it('never jumps sideways out of the cone', () => {
    expect(nearestInDirection(origin, [{ id: 'N', x: 0, y: -20 }], 'right')).toBeNull()
    expect(nearestInDirection(origin, [], 'left')).toBeNull()
  })

  it('ignores the site it starts from and breaks ties by id', () => {
    expect(nearestInDirection(origin, [{ id: 'SELF', x: 0, y: 0 }], 'right')).toBeNull()
    expect(nearestInDirection(origin, [{ id: 'B', x: 5, y: 1 }, { id: 'A', x: 5, y: -1 }], 'right')).toBe('A')
  })
})
