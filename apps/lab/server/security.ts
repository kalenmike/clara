const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export type LabRequestCheck = { ok: true } | { ok: false; status: number; message: string }

export const LAB_HEADER = 'x-clara-lab'

export function checkLabRequest(
  request: {
    headers: { host?: string; origin?: string; 'sec-fetch-site'?: string | string[] }
    socket: { remoteAddress?: string }
  },
  port: number
): LabRequestCheck {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return { ok: false, status: 403, message: 'Clara Lab is only available on loopback' }
  }
  if (!isAllowedHost(request.headers.host, port)) {
    return { ok: false, status: 403, message: 'The request Host is not the local lab' }
  }
  if (!isAllowedOrigin(request.headers.origin, port)) {
    return { ok: false, status: 403, message: 'The request Origin is not the local lab' }
  }
  const fetchSite = Array.isArray(request.headers['sec-fetch-site'])
    ? request.headers['sec-fetch-site'][0]
    : request.headers['sec-fetch-site']
  if (!isAllowedFetchSite(fetchSite)) {
    return { ok: false, status: 403, message: 'Cross-site requests are not allowed' }
  }
  return { ok: true }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '127.0.0.1' || normalized === '::1'
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  if (host.includes('/') || host.includes('\\') || host.includes('@') || host.includes('?')) {
    return false
  }

  let url: URL
  try {
    url = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false
  return url.port !== '' && Number(url.port) === port
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true
  if (!origin || origin === 'null') return false

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
  return isAllowedHost(url.host, port)
}

export function isAllowedFetchSite(value: string | undefined): boolean {
  if (value === undefined || value === 'none' || value === 'same-origin') return true
  return false
}
