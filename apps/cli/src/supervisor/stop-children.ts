import { waitFor } from '../service/probe.ts'

/**
 * A running child the supervisor can stop. The supervisor keeps its own map,
 * so the handle is read through closures instead of caching a pid.
 */
export type StoppableChild = {
  label: string
  exited: () => boolean
  signal: (signal: NodeJS.Signals) => void
}

export type StopChildrenOptions = {
  /** How long the whole set gets to exit after SIGTERM. */
  graceMs?: number
  /** How long it gets after SIGKILL before it is reported as a survivor. */
  killMs?: number
  pollMs?: number
  onEscalate?: (labels: string[]) => void
}

export type StopChildrenResult = {
  graceful: boolean
  survivors: string[]
}

const DEFAULT_GRACE_MS = 4_000
const DEFAULT_KILL_MS = 1_500
const DEFAULT_POLL_MS = 100

/**
 * Stop every child inside one bounded window: signal the whole set at once,
 * wait once, then kill the stragglers. Stopping children one at a time lets a
 * single stuck service consume the caller's entire stop budget, which left
 * orphaned services behind when `clara stop` gave up.
 */
export async function stopChildren(
  children: readonly StoppableChild[],
  options: StopChildrenOptions = {}
): Promise<StopChildrenResult> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  const killMs = options.killMs ?? DEFAULT_KILL_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const allExited = (): boolean => children.every((child) => child.exited())

  if (children.length === 0) return { graceful: true, survivors: [] }

  for (const child of children) {
    if (child.exited()) continue
    try {
      child.signal('SIGTERM')
    } catch {
      // The child is already gone.
    }
  }

  if (await waitFor(allExited, graceMs, pollMs)) {
    return { graceful: true, survivors: [] }
  }

  const stragglers = children.filter((child) => !child.exited())
  options.onEscalate?.(stragglers.map((child) => child.label))
  for (const child of stragglers) {
    try {
      child.signal('SIGKILL')
    } catch {
      // The child is already gone.
    }
  }
  await waitFor(allExited, killMs, Math.min(pollMs, 50))

  return {
    graceful: false,
    survivors: children.filter((child) => !child.exited()).map((child) => child.label),
  }
}
