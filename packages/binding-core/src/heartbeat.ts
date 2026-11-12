// Renew a step lease independently of model turns.
//
// A slow turn or a long tool call produces no adapter events, so the adapter
// renews on a timer. A lease rejection is final; a transient transport error is
// not.

export interface StepHeartbeatOptions {
  intervalMs?: number
  onLost?: (error: Error) => void
}

const STEP_HEARTBEAT_MS = 10_000

export function startStepHeartbeat(
  beat: () => Promise<unknown>,
  options: StepHeartbeatOptions = {}
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void beat().catch((error: unknown) => {
      const code = (error as { code?: string } | undefined)?.code
      const lost =
        code === 'lease_invalid' || code === 'step_not_running' || code === 'step_missing'
      if (!lost) return
      clearInterval(timer)
      options.onLost?.(error instanceof Error ? error : new Error(String(error)))
    })
  }, options.intervalMs ?? STEP_HEARTBEAT_MS)
  timer.unref?.()
  return timer
}
