import { hostname } from 'node:os'
import { RunnerClient } from './client.ts'
import { executeScript } from './execute.ts'
import type { RunnerConfig, RunnerStatus, ScriptWorkOrder } from './types.ts'

const DEFAULT_CONCURRENCY = 2
const DEFAULT_HEARTBEAT_MS = 10_000
const DEFAULT_POLL_MS = 1_000
const DEFAULT_ADAPTER_HEARTBEAT_MS = 30_000

export interface Runner {
  readonly id: string
  readonly workspace: string
  start(): Promise<void>
  stop(): Promise<void>
  /** Execute one already-claimed script order. Used by an embedded adapter. */
  execute(order: ScriptWorkOrder): Promise<void>
  /** Poll once; useful for tests and `--once`. */
  once(): Promise<number>
  status(): RunnerStatus
}

export function createRunner(config: RunnerConfig): Runner {
  const workspace = config.workspace
  const id = config.id ?? `clara-runner-${hostname()}-${process.pid}`
  const machine = config.machine ?? hostname()
  const labels = config.labels ?? []
  const capabilities = config.capabilities ?? ['script']
  const concurrency = Math.max(1, config.concurrency ?? DEFAULT_CONCURRENCY)
  const heartbeatMs = config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const pollMs = config.pollMs ?? DEFAULT_POLL_MS
  const adapterHeartbeatMs = config.adapterHeartbeatMs ?? DEFAULT_ADAPTER_HEARTBEAT_MS
  const logger = config.logger ?? console
  const client = new RunnerClient(config)

  let registered = false
  let started = false
  let stopped = true
  let polling = false
  let active = 0
  let completed = 0
  let failed = 0
  let lastError: string | undefined
  let pollTimer: NodeJS.Timeout | undefined
  let adapterTimer: NodeJS.Timeout | undefined

  const register = async (): Promise<void> => {
    try {
      await client.register({
        id,
        harness: 'clara-runner',
        machine,
        labels,
        workspace,
        capabilities,
      })
      registered = true
      lastError = undefined
    } catch (error) {
      registered = false
      lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`[clara-runner] registration failed: ${lastError}`)
    }
  }

  const heartbeatAdapter = async (): Promise<void> => {
    try {
      if (!registered) {
        await register()
        return
      }
      await client.heartbeatAdapter(id)
    } catch (error) {
      registered = false
      lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`[clara-runner] registration heartbeat failed: ${lastError}`)
    }
  }

  const run = (order: ScriptWorkOrder): Promise<void> => {
    active += 1
    return executeScript(client, order, { heartbeatMs, logger, workspace })
      .then((outcome) => {
        if (outcome.ok) {
          completed += 1
        } else if (!outcome.lostLease) {
          failed += 1
          lastError = outcome.reason
          logger.warn(`[clara-runner] ${order.step_path} failed: ${outcome.reason}`)
        }
      })
      .finally(() => {
        active -= 1
      })
  }

  const poll = async (wait = false): Promise<number> => {
    if (stopped || polling) return 0
    polling = true
    try {
      const capacity = concurrency - active
      if (capacity <= 0) return 0
      const orders = await client.workNext({
        workspace,
        capabilities,
        runner: { id, labels },
        limit: capacity,
      })
      const running = orders.map((order) => run(order))
      if (wait) await Promise.all(running)
      return orders.length
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`[clara-runner] claim failed: ${lastError}`)
      return 0
    } finally {
      polling = false
    }
  }

  return {
    id,
    workspace,

    async start(): Promise<void> {
      if (started && !stopped) return
      started = true
      stopped = false
      await register()
      adapterTimer = setInterval(() => void heartbeatAdapter(), adapterHeartbeatMs)
      pollTimer = setInterval(() => void poll(), pollMs)
      void poll()
    },

    async stop(): Promise<void> {
      stopped = true
      started = false
      if (pollTimer) clearInterval(pollTimer)
      if (adapterTimer) clearInterval(adapterTimer)
      pollTimer = undefined
      adapterTimer = undefined
      if (registered) {
        registered = false
        // A clean stop removes the row so status is accurate at once; a crash
        // still ages out through the engine's stale window.
        try {
          await client.removeAdapter(id)
        } catch {
          // Ignore: the engine drops the row once heartbeats stop.
        }
      }
    },

    async execute(order: ScriptWorkOrder): Promise<void> {
      await executeScript(client, order, { heartbeatMs, logger, workspace })
    },

    async once(): Promise<number> {
      stopped = false
      if (!registered) await register()
      return poll(true)
    },

    status(): RunnerStatus {
      return {
        id,
        workspace,
        registered,
        active,
        completed,
        failed,
        ...(lastError ? { lastError } : {}),
      }
    },
  }
}
