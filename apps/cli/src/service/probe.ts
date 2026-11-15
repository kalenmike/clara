export type ProbeResult = {
  ok: boolean
  status?: number
  body?: Record<string, unknown>
  error?: string
}

/** Ask a service whether it is the process we expected on this port. */
export async function probe(
  url: string,
  serviceId: string,
  timeoutMs = 1_200
): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok)
      return { ok: false, status: response.status, error: `HTTP ${response.status}` }
    const body = (await response.json()) as Record<string, unknown>
    if (body.service !== serviceId)
      return { ok: false, status: response.status, body, error: 'foreign' }
    return { ok: true, status: response.status, body }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  pollMs = 250
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(pollMs)
  }
  return false
}
