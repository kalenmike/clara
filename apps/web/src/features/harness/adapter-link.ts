const STORAGE_KEY = 'clara.adapter-link'

/** A `clara://adapter?code=…` link that arrived before the panel could open. */
export type PendingAdapterLink = {
  code: string
  kind?: string
}

/** Keep a one-time adapter link across a connect redirect. */
export function storePendingAdapterLink(link: PendingAdapterLink): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link))
  } catch {
    // Storage can be unavailable in private modes; the in-app navigation still works.
  }
}

export function readPendingAdapterLink(): PendingAdapterLink | undefined {
  try {
    const text = sessionStorage.getItem(STORAGE_KEY)
    if (!text) return undefined
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.code !== 'string' || !record.code.trim()) return undefined
    return {
      code: record.code,
      ...(typeof record.kind === 'string' && record.kind.trim() ? { kind: record.kind } : {}),
    }
  } catch {
    return undefined
  }
}

export function clearPendingAdapterLink(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
