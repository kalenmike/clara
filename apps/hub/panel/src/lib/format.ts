import type { PanelValueSource } from '@clara/shared-types'

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.floor(ms / 1_000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_024) return `${Math.floor(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1_024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatRelative(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '—'

  const delta = time - now
  const absolute = Math.abs(delta)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absolute < 60_000) return formatter.format(Math.round(delta / 1_000), 'second')
  if (absolute < 3_600_000) return formatter.format(Math.round(delta / 60_000), 'minute')
  if (absolute < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), 'hour')
  return formatter.format(Math.round(delta / 86_400_000), 'day')
}

export function shortId(value: string, length = 12): string {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

export function sourceLabel(source: PanelValueSource): string {
  switch (source) {
    case 'env':
      return 'environment'
    case 'file':
      return 'server.json'
    case 'database':
      return 'database'
    case 'generated':
      return 'generated'
    case 'runtime':
      return 'runtime'
    case 'none':
      return 'not set'
    default:
      return 'default'
  }
}

export function healthLabel(status: 'ok' | 'warn' | 'error' | 'missing'): string {
  switch (status) {
    case 'ok':
      return 'OK'
    case 'warn':
      return 'Check'
    case 'error':
      return 'Error'
    default:
      return 'Missing'
  }
}
