export type ServiceName = 'hub' | 'engine' | 'web'

export type Ports = {
  hubPanel: number
  hubLocal: number
  engine: number
  web: number
}

const DEFAULTS: Ports = { hubPanel: 8790, hubLocal: 8788, engine: 8789, web: 8080 }

export function resolvePorts(env: NodeJS.ProcessEnv = process.env): Ports {
  return {
    hubPanel: positive(env.CLARA_PANEL_PORT, DEFAULTS.hubPanel),
    hubLocal: positive(env.CLARA_LOCAL_PORT, DEFAULTS.hubLocal),
    engine: positive(env.CLARA_ENGINE_PORT, DEFAULTS.engine),
    web: positive(env.CLARA_WEB_PORT, DEFAULTS.web),
  }
}

export function portFor(service: ServiceName, ports: Ports): number {
  if (service === 'hub') return ports.hubPanel
  if (service === 'engine') return ports.engine
  return ports.web
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback
}
