import { spawn } from 'node:child_process'
import type { InstallRunResult, InstallRunner } from './types.ts'

const KILL_GRACE_MS = 3_000

/** Spawn a command, forward complete output lines, and honor cancellation. */
export const runProcess: InstallRunner = (command, args, onLine, signal) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const flush = (current: string, final: boolean): string => {
      let remaining = current
      let index = remaining.indexOf('\n')
      while (index >= 0) {
        onLine(remaining.slice(0, index))
        remaining = remaining.slice(index + 1)
        index = remaining.indexOf('\n')
      }
      if (final && remaining) {
        onLine(remaining)
        remaining = ''
      }
      return remaining
    }

    const kill = () => {
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      timer.unref?.()
    }
    const onAbort = () => kill()
    signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = flush(stdout + chunk.toString('utf8'), false)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = flush(stderr + chunk.toString('utf8'), false)
    })
    child.on('error', (cause) => {
      if (settled) return
      settled = true
      cleanup()
      reject(cause)
    })
    child.on('close', (code, closeSignal) => {
      if (settled) return
      settled = true
      cleanup()
      flush(stdout, true)
      flush(stderr, true)
      resolve({ exitCode: code, signal: closeSignal })
    })
  })
}

export type RunProcessResult = InstallRunResult
