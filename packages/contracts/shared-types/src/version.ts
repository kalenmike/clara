/** The Clara surface a build is running as. */
export type ClaraSurface = 'web' | 'pwa' | 'desktop' | 'hub' | 'lab'

const SURFACE_NAMES: Record<ClaraSurface, string> = {
  web: 'Web',
  pwa: 'PWA',
  desktop: 'Desktop',
  hub: 'Hub',
  lab: 'Lab',
}

/** The one label format every surface uses, e.g. `Clara Web · 0.1.0-dev+abc1234`. */
export function claraVersionLabel(surface: ClaraSurface, version: string): string {
  return `Clara ${SURFACE_NAMES[surface]} · ${version}`
}
