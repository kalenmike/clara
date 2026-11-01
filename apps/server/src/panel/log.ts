import type { PanelEvent } from '@clara/shared-types'

const MAX_MESSAGE_LENGTH = 300

/**
 * A small in-memory activity trail for the panel. It is intentionally not
 * persisted: the panel shows what this process has done since it started, and
 * the systemd journal remains the durable log.
 */
export class PanelLog {
  private readonly entries: PanelEvent[] = []
  private readonly max: number

  constructor(max = 60) {
    this.max = max
  }

  add(message: string, detail?: unknown): void {
    const text = detail === undefined ? message : `${message}: ${errorMessage(detail)}`
    this.entries.push({
      at: new Date().toISOString(),
      level: detail === undefined ? 'info' : 'error',
      message: clip(text, MAX_MESSAGE_LENGTH),
    })
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max)
    }
  }

  list(): PanelEvent[] {
    return [...this.entries]
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
