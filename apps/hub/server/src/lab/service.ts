import type { LabEndpoint } from '../api/context.ts'

/**
 * The lab service runs next to the engine, not inside the hub. Point the hub at
 * it with `CLARA_LAB_URL` and a shared `CLARA_LAB_TOKEN` when it is on another
 * host. `CLARA_LAB_URL=off` disables the bridge.
 */
export function labEndpoint(): LabEndpoint | undefined {
  const configured = process.env.CLARA_LAB_URL?.trim()
  if (configured && ['off', 'none', 'disabled'].includes(configured.toLowerCase())) {
    return undefined
  }
  const url = (configured || 'http://127.0.0.1:8791').replace(/\/+$/, '')
  const token = process.env.CLARA_LAB_TOKEN?.trim()
  return { url, ...(token ? { token } : {}) }
}
