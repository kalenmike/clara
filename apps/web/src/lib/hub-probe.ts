import type { ClaraClient } from '@clara/api-client'
import type { ApiInfo } from '@clara/api-contract'

/**
 * Prove the hub tunnel without requiring a live harness. `/v1/harness/info`
 * goes through the adapter, so using it here would turn an offline adapter
 * into a failed browser connection.
 */
export async function probeHub(
  client: { server: Pick<ClaraClient['server'], 'status'> },
  timeoutMs: number
): Promise<ApiInfo> {
  return client.server.status({ signal: AbortSignal.timeout(timeoutMs) })
}
