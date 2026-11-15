import type { ClientControl } from '@/lib/client'
import { isDesktop } from '@/lib/runtime'

/**
 * The lab is a desktop-only surface. Its server runs next to the engine, so the
 * browser reaches it through the hub bridge under `/v1/lab`, never through a
 * desktop sidecar or a loopback URL.
 */
export function labAvailable(): boolean {
  return isDesktop
}

export type LabHealth = {
  ok: boolean
  service?: string
  version?: string
  connected?: boolean
  tokenPresent?: boolean
  workspace?: string
  engineWorkspace?: string
}

/** Ask the hub bridge whether the lab server is reachable. */
export async function readLabHealth(
  control: Pick<ClientControl, 'fetch'>,
  timeoutMs = 8_000
): Promise<LabHealth> {
  const response = await control.fetch('/v1/lab/health', {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `The hub answered ${response.status} for the lab.`)
  }
  return (await response.json()) as LabHealth
}
