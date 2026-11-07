export function clock(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour12: false })
}

export function dateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function ago(value?: string | null): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function json(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function short(value: unknown, max = 140): string {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : json(value).replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function parseMaybeJson(value: string): unknown {
  const text = value.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return value
  }
}

export function statusTone(status: string): 'ok' | 'bad' | 'live' | 'idle' | 'warn' {
  if (['done', 'completed'].includes(status)) return 'ok'
  if (['failed', 'cancelled'].includes(status)) return 'bad'
  if (['running', 'ready', 'waiting_children'].includes(status)) return 'live'
  if (['waiting', 'pending'].includes(status)) return 'idle'
  return 'idle'
}
