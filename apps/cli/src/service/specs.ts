import { homedir } from 'node:os'
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

export const START_ORDER: readonly ServiceName[] = ['engine', 'lab', 'hub', 'web']
export const STOP_ORDER: readonly ServiceName[] = ['web', 'hub', 'lab', 'engine']

/**
 * The engine and Lab fall back to their working directory for the default
 * workspace. A supervised service starts wherever the login service happens to
 * run it, so the supervisor pins the value instead.
 */
function engineWorkspace(): string {
  return (
    process.env.CLARA_ENGINE_WORKSPACE?.trim() ||
    process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ||
    homedir()
  )
}

export const SPECS: Record<ServiceName, ServiceSpec> = {
  engine: {
    name: 'engine',
    label: 'engine',
    serviceId: 'clara-engine',
    healthPath: '/health',
    port: (ports) => portFor('engine', ports),
    url: (ports) => `http://127.0.0.1:${portFor('engine', ports)}`,
    env: (ports) => ({
      CLARA_ENGINE_PORT: String(portFor('engine', ports)),
      CLARA_ENGINE_WORKSPACE: engineWorkspace(),
    }),
  },
  lab: {
    name: 'lab',
    label: 'lab',
    serviceId: 'clara-lab',
    healthPath: '/api/health',
    port: (ports) => portFor('lab', ports),
    url: (ports) => `http://127.0.0.1:${portFor('lab', ports)}`,
    env: (ports) => ({
      CLARA_LAB_PORT: String(portFor('lab', ports)),
      // Keep the Lab on the same default workspace as the supervised engine.
      CLARA_ENGINE_WORKSPACE: engineWorkspace(),
      // Follow the supervised engine's address instead of the fixed default.
      CLARA_ENGINE_URL:
        process.env.CLARA_ENGINE_URL?.trim() ||
        process.env.CLARA_ORCHESTRATION_URL?.trim() ||
        `http://127.0.0.1:${portFor('engine', ports)}`,
    }),
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
      // The bridge target follows the supervised lab unless the host sets it.
      CLARA_LAB_URL:
        process.env.CLARA_LAB_URL?.trim() || `http://127.0.0.1:${portFor('lab', ports)}`,
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
  return value === 'hub' || value === 'engine' || value === 'web' || value === 'lab'
}

export function ordered(
  names: readonly ServiceName[],
  order: readonly ServiceName[]
): ServiceName[] {
  return order.filter((name) => names.includes(name))
}
