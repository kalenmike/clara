/**
 * Shut a foreground service down on the first signal, but never let a live
 * client or a stream keep it alive: the supervisor only gives the child a few
 * seconds before it kills it, and an orphaned service on the same port breaks
 * the next start.
 */
export type ShutdownOptions = {
  /** Prefix for a diagnostic written through `log`. */
  label: string
  close: () => Promise<void> | void
  /** Force a clean exit after this long. */
  timeoutMs?: number
  log?: (message: string, detail?: unknown) => void
}

const DEFAULT_TIMEOUT_MS = 2_000

/**
 * Run the close path once and exit. A deadline guarantees the process leaves
 * even if a live client or stream never lets `close` settle.
 */
export function shutdownService(options: ShutdownOptions): void {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = setTimeout(() => {
    options.log?.(`${options.label}: shutdown did not finish in ${timeoutMs}ms`)
    process.exit(0)
  }, timeoutMs)
  deadline.unref?.()

  void Promise.resolve()
    .then(options.close)
    .then(() => {
      clearTimeout(deadline)
      process.exit(0)
    })
    .catch((cause) => {
      clearTimeout(deadline)
      options.log?.(`${options.label}: shutdown failed`, cause)
      process.exit(1)
    })
}

export function installShutdownHandlers(options: ShutdownOptions): () => void {
  let stopping = false

  const run = (reason: string): void => {
    if (stopping) return
    stopping = true
    shutdownService({
      ...options,
      log: (message, detail) => options.log?.(`${message} (${reason})`, detail),
    })
  }

  const onSignal = (signal: NodeJS.Signals): void => run(signal)
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  return () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
