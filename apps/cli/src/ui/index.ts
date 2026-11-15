import { bold, cyan, dim, green, red, yellow } from './color.ts'
import { symbols } from './symbols.ts'

export type State = 'running' | 'starting' | 'stopped' | 'degraded' | 'failed' | 'missing'

export function stateLabel(state: State): string {
  if (state === 'running') return `${green(symbols.dot)} ${green('running')}`
  if (state === 'starting') return `${yellow(symbols.warn)} ${yellow('starting')}`
  if (state === 'degraded') return `${yellow(symbols.warn)} ${yellow('degraded')}`
  if (state === 'failed') return `${red(symbols.fail)} ${red('failed')}`
  if (state === 'missing') return `${dim(symbols.idle)} ${dim('not installed')}`
  return `${dim(symbols.idle)} ${dim('stopped')}`
}

export function heading(text: string): string {
  return `${bold(text)}`
}

export function step(text: string): string {
  return `${cyan(symbols.arrow)} ${text}`
}

export function bullet(text: string): string {
  return `  ${dim('•')} ${text}`
}

export function success(text: string): string {
  return `${green(symbols.ok)} ${text}`
}

export function warn(text: string): string {
  return `${yellow(symbols.warn)} ${text}`
}

export function failure(text: string): string {
  return `${red(symbols.fail)} ${text}`
}

export function muted(text: string): string {
  return dim(text)
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}
