export type WorkspacePage = 'desk' | 'map' | 'routes' | 'airports' | 'fleet' | 'orders' | 'catalog' | 'finance' | 'rivals' | 'report'
export type WorkspaceArea = 'desk' | 'network' | 'fleet' | 'company'

export const AREA_PAGES: Record<WorkspaceArea, readonly WorkspacePage[]> = {
  desk: ['desk'], network: ['map', 'routes', 'airports'],
  fleet: ['fleet', 'orders', 'catalog'], company: ['finance', 'rivals', 'report'],
}
export const PAGE_LABELS: Record<WorkspacePage, string> = {
  desk: 'Operations desk', map: 'Map', routes: 'Routes', airports: 'Airports',
  fleet: 'Owned aircraft', orders: 'Orders', catalog: 'Aircraft market',
  finance: 'Finances', rivals: 'Rivals', report: 'Reports',
}
export function areaFor(page: WorkspacePage): WorkspaceArea {
  return (Object.keys(AREA_PAGES) as WorkspaceArea[]).find((area) => AREA_PAGES[area].includes(page))!
}
