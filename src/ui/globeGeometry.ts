import geometryUrl from '../data/globemap.gen.json?url'

type Point = readonly [number, number]
export interface GlobeGeometry {
  WORLD_RINGS: readonly (readonly Point[])[]
  WORLD_RINGS_FINE: readonly (readonly Point[])[]
  BORDER_LINES: readonly (readonly Point[])[]
  ISLET_POINTS: readonly Point[]
}

// Native module imports retain failed loads in Chromium and WebKit. Data is
// fetched separately so an interrupted download can recover without reloading
// the career. Successful/in-flight loads are shared by map and replay views.
let pending: Promise<GlobeGeometry> | undefined
export function loadGlobeGeometry(): Promise<GlobeGeometry> {
  pending ??= fetch(geometryUrl).then((response) => {
    if (!response.ok) throw new Error('Globe geometry unavailable')
    return response.json() as Promise<GlobeGeometry>
  }).catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending
}
