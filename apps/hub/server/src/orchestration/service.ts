import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PanelOrchestrationControl } from '@clara/shared-types'
import {
  baseURL,
  collectStatus,
  startLocalService,
  stopService,
  type StatusReport,
} from '@clara/service-control'
import { PanelControlError } from '../panel/controls.ts'

/** Resolve the built engine, or its source in a development checkout. */
export function orchestrationCommand(): string[] | undefined {
  const configured =
    process.env.CLARA_ENGINE_ENTRY?.trim() || process.env.CLARA_ORCHESTRATOR_ENTRY?.trim()
  if (configured) return commandFor(configured)

  const root = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)))
  if (!root) return undefined

  const built = join(root, 'apps/engine/dist/index.js')
  if (existsSync(built)) return commandFor(built)

  const source = join(root, 'apps/engine/src/index.ts')
  if (existsSync(source)) return commandFor(source)

  return undefined
}

function commandFor(entry: string): string[] {
  if (entry.endsWith('.ts')) {
    return [process.execPath, '--experimental-strip-types', '--no-warnings', entry]
  }
  return [process.execPath, entry]
}

function findRepositoryRoot(start: string): string | undefined {
  let directory = start
  for (;;) {
    if (existsSync(join(directory, 'apps/engine/package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function toState(report: StatusReport): PanelOrchestrationControl['state'] {
  if (report.state === 'stopped') return 'stopped'
  return report.state
}

function reportError(report: StatusReport): string | undefined {
  if (report.state === 'foreign') {
    return `${report.url} is being used by another service`
  }
  if (report.state === 'unresponsive') {
    return `The engine process at ${report.url} is not responding`
  }
  return undefined
}

/** Read the live service state without changing it. */
export async function readOrchestrationControl(
  desired: boolean,
  previousError?: string
): Promise<PanelOrchestrationControl> {
  const report = await collectStatus()
  const state = toState(report)
  const effective = state === 'local' || state === 'container' || state === 'external'
  const error = (effective ? undefined : reportError(report)) ?? previousError
  return {
    desired,
    effective,
    state,
    url: report.url,
    ...(report.pid !== null ? { pid: report.pid } : {}),
    ...(error ? { error } : {}),
  }
}

/** Start a local service when nothing else is answering. */
export async function startOrchestration(): Promise<void> {
  if (isContainerized()) {
    const report = await collectStatus()
    if (report.state === 'local' || report.state === 'container' || report.state === 'external') {
      return
    }
    throw new PanelControlError(
      409,
      'orchestrator_container',
      'The engine is managed by Docker on this host. Start it with `pnpm clara start engine --docker` or docker compose.'
    )
  }

  const command = orchestrationCommand()
  if (!command) {
    throw new PanelControlError(
      503,
      'orchestrator_missing',
      'The engine is not built. Run `pnpm build` and try again.'
    )
  }

  const result = await startLocalService({ command })
  if (result.kind === 'started' || result.kind === 'already-running') return
  if (result.kind === 'unresponsive') {
    throw new PanelControlError(
      409,
      'orchestrator_unresponsive',
      `The engine process (pid ${result.pid}) is alive but not answering at ${baseURL()}`
    )
  }
  if (result.kind === 'foreign') {
    throw new PanelControlError(
      409,
      'orchestrator_port_busy',
      `Another service is already using ${baseURL()}`
    )
  }
  throw new PanelControlError(
    503,
    'orchestrator_unhealthy',
    `The engine did not become healthy at ${baseURL()}. Check \`pnpm clara status engine\`.`
  )
}

/** Stop only a local instance started from this data directory. */
export async function stopOrchestration(): Promise<void> {
  const result = await stopService()
  if (result.kind === 'stopped' || result.kind === 'already-stopped') return
  if (result.kind === 'container') {
    throw new PanelControlError(
      409,
      'orchestrator_container',
      'The engine is running in Docker. Stop it with `pnpm clara stop engine --docker`.'
    )
  }
  if (result.kind === 'external') {
    throw new PanelControlError(
      409,
      'orchestrator_external',
      'The engine was started outside this data directory. Stop it where it was started.'
    )
  }
  if (result.kind === 'foreign') {
    throw new PanelControlError(
      409,
      'orchestrator_port_busy',
      `Another service is already using ${baseURL()}`
    )
  }
  if (result.kind === 'not-exited') {
    throw new PanelControlError(
      503,
      'orchestrator_stopping',
      `The engine process (pid ${result.pid}) did not exit after SIGTERM`
    )
  }
  if (result.kind === 'error') {
    throw new PanelControlError(503, 'orchestrator_stop_failed', result.message)
  }
  throw new PanelControlError(503, 'orchestrator_stop_failed', 'Could not stop the engine')
}

function isContainerized(): boolean {
  const value = process.env.CLARA_SERVER_CONTAINER?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}
