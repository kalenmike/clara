import { OpenCode } from '@opencode/client'

export type ConnectionConfig = {
  /** Base URL without a trailing slash. Local proxy mode uses `<origin>/oc`. */
  baseUrl: string
  /** Password for the `opencode` basic-auth user. Omitted for the dev proxy. */
  password?: string
  /** Human-readable label shown in the UI. */
  label?: string
  /** Persist the password in local storage instead of session storage. */
  remember?: boolean
}

export type OpenCodeClient = ReturnType<typeof OpenCode.make>

export type ServerInfo = Awaited<ReturnType<OpenCodeClient['server']['info']>>

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function basicAuth(password: string) {
  const bytes = new TextEncoder().encode(`opencode:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

export function createClient(config: ConnectionConfig): OpenCodeClient {
  return OpenCode.make({
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    headers: config.password ? { authorization: basicAuth(config.password) } : undefined,
  })
}

export async function fetchServerInfo(
  config: ConnectionConfig,
  signal?: AbortSignal
): Promise<ServerInfo> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/info`, {
    headers: config.password ? { authorization: basicAuth(config.password) } : undefined,
    signal,
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Check the server password.')
    }
    throw new Error(`Server responded with ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as ServerInfo
}

/** The Vite dev server proxies `/oc` to the local OpenCode service with auth. */
export function localProxyConfig(): ConnectionConfig {
  return {
    baseUrl: `${window.location.origin}/oc`,
    label: 'Local OpenCode service',
  }
}

export async function detectLocalService(): Promise<ServerInfo | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2500)
  try {
    return await fetchServerInfo(localProxyConfig(), controller.signal)
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export function describeConnectionError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return 'Timed out while contacting the server.'
  }
  if (error instanceof TypeError) {
    return 'Could not reach the server. Check the URL, CORS settings, and that OpenCode is running.'
  }
  if (error instanceof Error) return error.message
  return 'Unknown connection error.'
}
