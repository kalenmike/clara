import { existsSync } from 'node:fs'
import { adapterBinaryPath, runStreamed } from '../adapters/install.ts'
import { adapterEnv, readAdapterState } from '../adapters/state.ts'
import { resolvePaths } from '../paths.ts'
import { parseKindSpec } from './adapter-args.ts'

export type AdapterControlAction = 'start' | 'stop' | 'status' | 'logs'

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
  const binary = adapterBinaryPath(record)
  if (!existsSync(binary)) {
    throw new Error(`The recorded ${spec.kind} binary is missing at ${binary}. Reinstall it.`)
  }
  const result = await runStreamed(
    binary,
    [action, ...extra],
    adapterEnv(resolvePaths(), spec.kind)
  )
  return result.code
}
