export type WorkspacePage = 'desk' | 'map' | 'routes' | 'airports' | 'fleet' | 'operations' | 'orders' | 'catalog' | 'finance' | 'outlook' | 'rivals' | 'report'
export type WorkspaceArea = 'desk' | 'network' | 'fleet' | 'company'

export const AREA_PAGES: Record<WorkspaceArea, readonly WorkspacePage[]> = {
  desk: ['desk'], network: ['map', 'routes', 'airports'],
  fleet: ['fleet', 'operations', 'orders', 'catalog'], company: ['finance', 'outlook', 'rivals', 'report'],
}
export const PAGE_LABELS: Record<WorkspacePage, string> = {
  desk: 'Operations desk', map: 'Map', routes: 'Routes', airports: 'Airports',
  fleet: 'Owned aircraft', operations: 'Operations', orders: 'Orders', catalog: 'Aircraft market',
  finance: 'Finances', outlook: 'Outlook', rivals: 'Rivals', report: 'Reports',
}
export function areaFor(page: WorkspacePage): WorkspaceArea {
  return (Object.keys(AREA_PAGES) as WorkspaceArea[]).find((area) => AREA_PAGES[area].includes(page))!
}
