const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatCost(
  value: number | undefined,
  options: { estimated?: boolean } = {}
): string {
  const text = !value
    ? '$0.00'
    : value < 0.01
      ? `$${value.toFixed(4)}`
      : value < 1
        ? `$${value.toFixed(3)}`
        : `$${value.toFixed(2)}`
  return options.estimated ? `~${text}` : text
}

export function formatTokens(value: number | undefined): string {
  if (!value) return '0'
  return compact.format(value)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value)
}

export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return 'never'
  const delta = timestamp - Date.now()
  const minutes = Math.round(delta / 60_000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return relative.format(days, 'day')
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * How long ago a session started, rounded down to whole units so a session
 * opened moments ago does not read as a whole minute old.
 */
export function formatSessionAge(created: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - created)
  if (elapsed < 60_000) return 'started just now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `started ${countUnit(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `started ${countUnit(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `started ${countUnit(days, 'day')} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `started ${countUnit(months, 'month')} ago`
  return `started ${countUnit(Math.max(1, Math.floor(days / 365)), 'year')} ago`
}

function countUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

export function formatDateTime(timestamp: number | undefined): string {
  if (!timestamp) return 'unknown'
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Commit dates can be older than a year, so keep the year in view. */
export function formatCommitDate(value: string | undefined): string {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(start: number, end?: number): string {
  if (!end) return 'running'
  const ms = Math.max(0, end - start)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function modelLabel(model: { id?: string; providerID?: string } | undefined): string {
  if (!model?.id) return 'model'
  return model.id
}

export function providerLabel(providerID: string | undefined): string {
  if (!providerID) return ''
  return providerID
}

export function contextPercent(used: number | undefined, limit: number | undefined): number {
  if (!used || !limit) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max) return value
  const half = Math.floor((max - 1) / 2)
  return `${value.slice(0, half)}…${value.slice(-half)}`
}
