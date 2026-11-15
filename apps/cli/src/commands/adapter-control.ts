import { existsSync } from 'node:fs'
import {
  containerLogs,
  inspectContainer,
  runDocker,
  startContainer,
  stopContainer,
} from '../adapters/container.ts'
import { adapterCommand, adapterEntryPath, runAdapterCommand } from '../adapters/install.ts'
import { readAdapterState, type AdapterInstallRecord } from '../adapters/state.ts'
import { resolvePaths } from '../paths.ts'
import { parseKindSpec } from './adapter-args.ts'

export type AdapterControlAction = 'start' | 'stop' | 'status' | 'logs' | 'verify'

/**
 * `start|stop|status|logs` run the installed binary's own subcommand, so the
 * adapter keeps ownership of its pid file, log, and service conventions.
 */
export async function runAdapterControl(
  action: AdapterControlAction,
  args: readonly string[]
): Promise<number> {
  const index = args.findIndex((arg) => !arg.startsWith('-'))
  const value = index >= 0 ? args[index] : undefined
  if (!value) throw new Error(`usage: clara adapter ${action} <kind>`)
  const spec = parseKindSpec(value)
  const extra = args.filter((_, position) => position !== index)

  const record = readAdapterState(resolvePaths()).adapters[spec.kind]
  if (!record) {
    throw new Error(
      `${spec.kind} adapter is not installed. Run: clara adapter install ${spec.kind}`
    )
  }
  if (record.container) return runContainerControl(action, record, extra)
  if (!existsSync(adapterEntryPath(record))) {
    throw new Error(
      `The recorded ${spec.kind} entry is missing at ${adapterEntryPath(record)}. Reinstall it.`
    )
  }
  const result = await runAdapterCommand(
    { paths: resolvePaths() },
    adapterCommand(record),
    [action, ...extra],
    spec.kind
  )
  return result.code
}

/**
 * Docker owns a container adapter, so start and stop address the container and
 * status, logs, and verify run inside it. A stopped container cannot exec.
 */
function runContainerControl(
  action: AdapterControlAction,
  record: AdapterInstallRecord,
  extra: readonly string[]
): number {
  const container = record.container
  if (!container) return 1
  if (action === 'start') return report(startContainer(container.name), `start ${container.name}`)
  if (action === 'stop') return report(stopContainer(container.name), `stop ${container.name}`)
  if (action === 'logs') {
    return report(
      containerLogs(container.name, logLines(extra)),
      `read logs from ${container.name}`
    )
  }

  const info = inspectContainer(container.name)
  if (!info.running) {
    throw new Error(
      `Container ${container.name} is stopped. Start it with: clara adapter start ${record.kind}`
    )
  }
  return report(
    runDocker(['exec', container.name, ...info.entry, action, ...extra]),
    `run ${action} in ${container.name}`
  )
}

function report(result: { code: number; stdout: string; stderr: string }, action: string): number {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.code !== 0 && !result.stderr.trim()) console.error(`Could not ${action}.`)
  return result.code
}

function logLines(extra: readonly string[]): number {
  for (let index = 0; index < extra.length; index += 1) {
    if (extra[index] !== '--lines' && extra[index] !== '-n') continue
    const value = Number.parseInt(extra[index + 1] ?? '', 10)
    return Number.isInteger(value) && value > 0 ? value : 80
  }
  return 80
}
