import type { ServiceName } from '../ports.ts'
import { portFor, type Ports } from '../ports.ts'

export type ServiceSpec = {
  name: ServiceName
  label: string
  serviceId: string
  healthPath: string
  port: (ports: Ports) => number
  url: (ports: Ports) => string
  env: (ports: Ports) => NodeJS.ProcessEnv
}

export const START_ORDER: readonly ServiceName[] = ['engine', 'hub', 'web']
export const STOP_ORDER: readonly ServiceName[] = ['web', 'hub', 'engine']

export const SPECS: Record<ServiceName, ServiceSpec> = {
  engine: {
    name: 'engine',
    label: 'engine',
    serviceId: 'clara-engine',
    healthPath: '/health',
    port: (ports) => portFor('engine', ports),
    url: (ports) => `http://127.0.0.1:${portFor('engine', ports)}`,
    env: (ports) => ({ CLARA_ENGINE_PORT: String(portFor('engine', ports)) }),
  },
  hub: {
    name: 'hub',
    label: 'hub',
    serviceId: 'clara-server',
    healthPath: '/health',
    port: (ports) => portFor('hub', ports),
    url: (ports) => `http://127.0.0.1:${portFor('hub', ports)}`,
    env: (ports) => ({
      CLARA_PANEL_PORT: String(ports.hubPanel),
      CLARA_LOCAL_PORT: String(ports.hubLocal),
    }),
  },
  web: {
    name: 'web',
    label: 'web',
    serviceId: 'clara-web',
    healthPath: '/healthz',
    port: (ports) => portFor('web', ports),
    url: (ports) => `http://127.0.0.1:${portFor('web', ports)}`,
    env: (ports) => ({ CLARA_WEB_PORT: String(portFor('web', ports)) }),
  },
}

export function isServiceName(value: string): value is ServiceName {
  return value === 'hub' || value === 'engine' || value === 'web'
}

export function ordered(
  names: readonly ServiceName[],
  order: readonly ServiceName[]
): ServiceName[] {
  return order.filter((name) => names.includes(name))
}
