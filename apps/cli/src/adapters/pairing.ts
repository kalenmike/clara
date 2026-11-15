import { main as hubMain } from '@clara/hub-server/main'
import type { PanelHarnessPairing } from '@clara/shared-types'

export type PairingTransport = 'local' | 'relay'

export type PairingMain = (args: string[]) => Promise<void>

export type PairingOptions = {
  main?: PairingMain
  label?: string
}

/**
 * Ask the hub for a one-time adapter pairing code without starting a second
 * service. The hub command prints its JSON result, so stdout is captured for
 * the duration of the call and restored afterwards.
 */
export async function issueAdapterPairing(
  kind: string,
  transport: PairingTransport,
  options: PairingOptions = {}
): Promise<PanelHarnessPairing> {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const originalExitCode = process.exitCode

  console.log = (...parts: unknown[]) => stdout.push(parts.map(String).join(' '))
  console.error = (...parts: unknown[]) => stderr.push(parts.map(String).join(' '))
  let exitCode: number | undefined
  try {
    await (options.main ?? hubMain)([
      'pair-adapter',
      '--kind',
      kind,
      '--transport',
      transport,
      ...(options.label ? ['--label', options.label] : []),
      '--json',
    ])
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined
  } catch (cause) {
    exitCode = 1
    stderr.push(cause instanceof Error ? cause.message : String(cause))
  } finally {
    console.log = originalLog
    console.error = originalError
    process.exitCode = originalExitCode
  }

  if (exitCode && exitCode !== 0) {
    throw new Error(
      stderr.join('\n').trim() ||
        `The hub could not issue a ${kind} pairing code (exit ${exitCode}).`
    )
  }
  return parsePairing(stdout)
}

function parsePairing(lines: readonly string[]): PanelHarnessPairing {
  for (const line of lines) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const parsed = JSON.parse(text) as { pairing?: PanelHarnessPairing }
      if (parsed.pairing?.code && parsed.pairing.kind) return parsed.pairing
    } catch {
      // Keep looking; a log line can start with a brace.
    }
  }
  throw new Error('The hub did not return a pairing code.')
}
