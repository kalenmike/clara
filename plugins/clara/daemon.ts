// Clara — the daemon.
//
// The ledger is deterministic. This file is the small scheduler around it:
// run the deterministic tick rules, reconcile the worker sessions recorded in
// `runs`, and launch the next stage through OpenCode's session API.
//
// Clara (the primary agent) stays a read-only interface. It never spawns a
// worker; it only submits, asks, approves, and resolves. The daemon owns the
// loop and holds `daemon_lock` while it ticks.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Db, Row } from './db.ts'
import { collectAlerts } from './alerts.ts'
import { deliverAttention } from './attention.ts'
import { pipelineForRequest, renderInstructions } from './pipeline.ts'
import { appendEvent, decide, stageCompleted, tick as ledgerTick, workspaceOf } from './queries.ts'
import {
  acquireDaemonLock,
  activeRequests,
  finishRun,
  hasOpenDecision,
  latestRun,
  markRunning,
  nextStage,
  releaseDaemonLock,
  startRun,
  waitingRuns,
  type RunRow,
  type RunWithRequest,
  type StageStep,
  type TransitionStep,
} from './runs.ts'

export interface DaemonModel {
  providerID: string
  id: string
  variant?: string
}

export interface DaemonSessionInfo {
  id: string
  agent?: string
  parentID?: string
  metadata?: Record<string, unknown>
  model?: { id?: string; modelID?: string; providerID: string; variant?: string } | null
  outcome?: 'succeeded' | 'failed' | 'interrupted'
  time?: { idle?: number; archived?: number | null }
}

/** Metadata that marks a session as daemon-owned rather than a human session. */
export const DAEMON_SESSION_METADATA = {
  initiatedBy: 'daemon',
  automation: true,
} as const

/** Metadata that marks the daemon handoff as non-user input in the transcript. */
export const DAEMON_PROMPT_METADATA = {
  source: 'daemon',
  synthetic: true,
} as const

export interface DaemonSessionApi {
  create(input: {
    title?: string
    location?: { directory: string }
    model?: DaemonModel
    metadata?: Record<string, unknown>
  }): Promise<{ id: string }>
  switchAgent(input: { sessionID: string; agent: string }): Promise<void>
  prompt(input: {
    sessionID: string
    text: string
    metadata?: Record<string, unknown>
    delivery?: 'steer' | 'queue'
  }): Promise<unknown>
  get(input: { sessionID: string }): Promise<DaemonSessionInfo>
  list?(input: { directory?: string; limit?: number }): Promise<unknown>
  interrupt?(input: { sessionID: string; resume?: boolean }): Promise<unknown>
  remove?(input: { sessionID: string }): Promise<void>
}

export interface DaemonContext {
  session?: DaemonSessionApi
  model?: { default(): Promise<unknown> }
  location?: { directory?: string }
  options?: Record<string, unknown>
}

export interface DaemonLogger {
  info(message: string): void
  error(message: string, error?: unknown): void
}

export interface DaemonOptions {
  db: Db
  ctx: DaemonContext
  intervalMs?: number
  lockStaleMs?: number
  maxSpawnsPerTick?: number
  /** Deliver ledger exceptions into Clara sessions. Defaults to true. */
  attention?: boolean
  owner?: string
  pid?: number
  /** When this returns false the loop stays loaded but does no work. */
  management?: () => Promise<boolean>
  logger?: DaemonLogger
}

export interface Daemon {
  start(): void
  stop(): void
  runOnce(): Promise<string[]>
}

interface TickOptions {
  db: Db
  ctx: DaemonContext
  maxSpawns: number
  attention: boolean
  logger: DaemonLogger
}

const defaultLogger: DaemonLogger = {
  info: (message) => console.log(`[clara] ${message}`),
  error: (message, error) => console.error(`[clara] ${message}`, error ?? ''),
}

const pad = (n: number): string => String(n).padStart(3, '0')
const recordCommitFailures = new Set<number>()

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ageMs(iso: string): number {
  const at = new Date(iso).getTime()
  return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY
}

function sessionApi(ctx: DaemonContext): DaemonSessionApi | undefined {
  const session = ctx.session
  if (!session?.create || !session.get || !session.prompt || !session.switchAgent) return
  return session
}

/**
 * Pick the model for a worker session. The user's own session is the best
 * source: submitting from Clara binds the worker to the model Clara is using.
 * The plugin option and the global default are fallbacks, in that order.
 */
async function resolveModel(
  ctx: DaemonContext,
  directory: string
): Promise<DaemonModel | undefined> {
  const configured = modelFromOption(ctx.options?.daemonModel)
  if (configured) return configured

  if (ctx.session?.list) {
    try {
      const sessions = unwrapList(await ctx.session.list({ directory, limit: 50 }))
      const withModel = sessions.filter(
        (session) => session.model?.providerID && (session.model.id || session.model.modelID)
      )
      const chosen = withModel.find((session) => session.agent === 'clara') ?? withModel[0]
      if (chosen?.model) {
        return {
          providerID: chosen.model.providerID,
          id: String(chosen.model.id ?? chosen.model.modelID),
          ...(chosen.model.variant ? { variant: chosen.model.variant } : {}),
        }
      }
    } catch {
      // Fall through to the global default.
    }
  }

  if (ctx.model?.default) {
    try {
      const info = unwrapData(await ctx.model.default()) as {
        providerID?: string
        modelID?: string
        id?: string
      } | null
      if (info?.providerID && (info.modelID || info.id)) {
        return { providerID: info.providerID, id: String(info.modelID ?? info.id) }
      }
    } catch {
      // No default model.
    }
  }

  return
}

function modelFromOption(value: unknown): DaemonModel | undefined {
  if (typeof value === 'string' && value.includes('/')) {
    const [providerID, ...rest] = value.split('/')
    const id = rest.join('/')
    return providerID && id ? { providerID, id } : undefined
  }

  if (value && typeof value === 'object') {
    const record = value as {
      providerID?: unknown
      id?: unknown
      modelID?: unknown
      variant?: unknown
    }
    if (
      typeof record.providerID === 'string' &&
      (typeof record.id === 'string' || typeof record.modelID === 'string')
    ) {
      return {
        providerID: record.providerID,
        id: String(record.id ?? record.modelID),
        ...(typeof record.variant === 'string' ? { variant: record.variant } : {}),
      }
    }
  }

  return
}

function unwrapList(value: unknown): DaemonSessionInfo[] {
  if (Array.isArray(value)) return value as DaemonSessionInfo[]
  const data = (value as { data?: unknown })?.data
  return Array.isArray(data) ? (data as DaemonSessionInfo[]) : []
}

function unwrapData(value: unknown): unknown {
  const data = (value as { data?: unknown })?.data
  return data ?? value
}

/**
 * Start the daemon. It ticks immediately after a short delay, then on an
 * interval. Returning the cleanup lets OpenCode stop the timer on reload.
 */
export function createDaemon(options: DaemonOptions): Daemon {
  const { db, ctx } = options
  const intervalMs = positive(options.intervalMs, 15_000)
  const lockStaleMs = positive(options.lockStaleMs, Math.max(60_000, intervalMs * 20))
  const maxSpawns = Math.max(1, Math.floor(options.maxSpawnsPerTick ?? 1))
  const owner = options.owner ?? randomUUID()
  const pid = options.pid ?? process.pid
  const logger = options.logger ?? defaultLogger

  let timer: ReturnType<typeof setInterval> | undefined
  let kick: ReturnType<typeof setTimeout> | undefined
  let running = false
  let stopped = false
  let idleForManagement = false

  const runOnce = async (): Promise<string[]> => {
    if (running || stopped) return []
    if (options.management && !(await options.management())) {
      if (!idleForManagement) {
        idleForManagement = true
        logger.info('daemon idle: Clara management is disabled')
      }
      return []
    }
    if (idleForManagement) {
      idleForManagement = false
      logger.info('daemon resumed: Clara management is enabled')
    }
    if (!sessionApi(ctx)) {
      logger.error('daemon: session API unavailable; not ticking')
      return []
    }

    running = true
    try {
      if (!acquireDaemonLock(db, owner, pid, lockStaleMs)) return []
      try {
        const actions = await advance({
          db,
          ctx,
          maxSpawns,
          attention: options.attention !== false,
          logger,
        })
        for (const action of actions) logger.info(action)
        return actions
      } finally {
        releaseDaemonLock(db, owner)
      }
    } catch (error) {
      logger.error('daemon tick failed', error)
      return []
    } finally {
      running = false
    }
  }

  return {
    runOnce,
    start() {
      if (stopped || timer) return
      timer = setInterval(() => void runOnce(), intervalMs)
      timer.unref?.()
      // Let the server finish loading agents before the first spawn.
      kick = setTimeout(() => void runOnce(), 1_000)
      kick.unref?.()
      logger.info(`daemon started (every ${Math.round(intervalMs / 1000)}s)`)
    },
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      if (kick) clearTimeout(kick)
      timer = undefined
      kick = undefined
      // A live tick releases the lock in its own finally. Releasing it here
      // would let another instance tick while this one is still working.
      if (running) return
      try {
        releaseDaemonLock(db, owner)
      } catch (error) {
        logger.error('daemon: could not release the lock', error)
      }
    },
  }
}

/** One deterministic pass: reconcile sessions, tick the rules, launch at most `maxSpawns`. */
export async function advance(options: TickOptions): Promise<string[]> {
  if (!sessionApi(options.ctx)) return []

  await reconcileRuns(options)
  ledgerTick(options.db, { dry_run: false })
  const alerts = collectAlerts(options.db)
  if (alerts.length) {
    for (const alert of alerts) options.logger.info(`alert: ${alert.title}`)
  }

  const actions: string[] = []
  if (options.attention) {
    const session = sessionApi(options.ctx)
    if (session) {
      try {
        actions.push(
          ...(await deliverAttention({
            db: options.db,
            session,
            fallbackDirectory: options.ctx.location?.directory,
            createSession: async (input) => {
              const model = await resolveModel(options.ctx, input.workspacePath)
              if (!model) {
                options.logger.error(`attention: no model available for ${input.title}`)
                return
              }

              const created = await session.create({
                title: input.title,
                location: { directory: input.workspacePath },
                model,
                metadata: input.metadata,
              })

              try {
                await session.switchAgent({ sessionID: created.id, agent: 'clara' })
              } catch (error) {
                if (session.remove) {
                  await session.remove({ sessionID: created.id }).catch(() => {})
                }
                throw error
              }

              return created
            },
            logger: options.logger,
          }))
        )
      } catch (error) {
        options.logger.error('attention delivery failed', error)
      }
    }
  }

  commitClosedRecords(options)

  let spawned = 0

  for (const request of activeRequests(options.db)) {
    if (spawned >= options.maxSpawns) break
    if (request.stalled_at) continue
    if (hasOpenDecision(options.db, Number(request.id))) continue

    const next = nextStage(options.db, request)
    if (!next) continue

    if (next.kind === 'transition') {
      actions.push(transitionRequest(options, request, next))
      continue
    }

    const stage = next.stage
    const latest = latestRun(options.db, Number(request.id), stage.id)
    if (latest && (latest.status === 'starting' || latest.status === 'running')) continue

    if (latest && latest.status === 'done') {
      ensureDecision(
        options,
        request,
        { stage: stage.id, agent: stage.agent },
        `The ${stage.id} stage is recorded done but the ledger still asks for it.`,
        'blocked'
      )
      continue
    }

    if (latest && (latest.status === 'failed' || latest.status === 'interrupted')) {
      if (!retryAllowed(options.db, latest)) {
        ensureDecision(
          options,
          request,
          { stage: stage.id, agent: stage.agent },
          `The ${stage.id} stage failed and is waiting for a resolved decision.`,
          'blocked'
        )
        continue
      }
    }

    const desired =
      stage.phase === 'work'
        ? 'running'
        : stage.phase === 'review' || stage.phase === 'close'
          ? 'review'
          : undefined
    if (desired && request.state !== desired) {
      try {
        appendEvent(options.db, {
          request: request.id,
          type: `request.${desired}`,
          actor: 'ai_0',
          state: desired,
          payload: { stage: stage.id, reason: next.reason },
        })
      } catch (error) {
        ensureDecision(
          options,
          request,
          { stage: stage.id, agent: stage.agent },
          `Could not move the request to ${desired}: ${message(error)}`,
          'failed'
        )
        continue
      }
      request.state = desired
    }

    actions.push(await spawnStage(options, request, next))
    spawned++
  }

  return actions
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

async function reconcileRuns(options: TickOptions): Promise<void> {
  const session = sessionApi(options.ctx)
  if (!session) return

  for (const run of waitingRuns(options.db)) {
    const terminal = run.request_state === 'completed' || run.request_state === 'cancelled'

    if (!run.session_id) {
      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'request closed before the stage started')
        continue
      }
      // A crash between startRun and markRunning leaves a starting row. Give
      // the live path a minute, then report it instead of spawning a duplicate.
      if (ageMs(run.created_at) < 60_000) continue
      const reason = 'the daemon could not create a session for this stage'
      finishRun(options.db, run.id, 'failed', reason)
      writeRunEvent(options.db, options.logger, run, 'stage.failed', reason)
      ensureRunDecision(options, run, reason)
      continue
    }

    try {
      const info = await session.get({ sessionID: run.session_id })

      if (!info.outcome) {
        if (!terminal) continue
        if (session.interrupt) {
          try {
            await session.interrupt({ sessionID: run.session_id, resume: false })
          } catch (error) {
            options.logger.error(`daemon: could not interrupt ${run.session_id}`, error)
          }
        }
        finishRun(options.db, run.id, 'interrupted', 'request closed before the stage finished')
        continue
      }

      const request = options.db
        .prepare('SELECT * FROM requests WHERE id = ?')
        .get(run.request_id) as Row

      if (info.outcome === 'succeeded' && stageSatisfied(options.db, request, run.stage)) {
        finishRun(options.db, run.id, 'done', 'stage completed')
        writeRunEvent(options.db, options.logger, run, 'stage.done')
        continue
      }

      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'request closed before the stage finished')
        continue
      }

      const status = info.outcome === 'interrupted' ? 'interrupted' : 'failed'
      const reason = failureReason(options.db, request, run.stage, info.outcome)
      finishRun(options.db, run.id, status, reason)
      writeRunEvent(options.db, options.logger, run, 'stage.failed', reason)
      ensureRunDecision(options, run, reason)
    } catch (error) {
      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'request closed before the stage finished')
        continue
      }
      const reason = `session ${run.session_id} could not be read: ${message(error)}`
      finishRun(options.db, run.id, 'failed', reason)
      writeRunEvent(options.db, options.logger, run, 'stage.failed', reason)
      ensureRunDecision(options, run, reason)
    }
  }
}

async function spawnStage(options: TickOptions, request: Row, next: StageStep): Promise<string> {
  const { db, ctx, logger } = options
  const session = sessionApi(ctx)
  if (!session) return 'daemon: session API unavailable'

  const stage = next.stage
  const label = `${pad(Number(request.id))} ${request.slug}`
  const workspace = workspaceOf(db, request)
  const path = String(workspace.path)

  if (!existsSync(path)) {
    const reason = `workspace path ${path} does not exist`
    ensureDecision(options, request, { stage: stage.id, agent: stage.agent }, reason, 'blocked')
    return `${label}: skipped ${stage.id} — ${reason}`
  }

  const model = await resolveModel(ctx, path)
  if (!model) {
    const reason =
      'no model is available for a worker session; set daemonModel or submit from a session with a model'
    ensureDecision(options, request, { stage: stage.id, agent: stage.agent }, reason, 'blocked')
    return `${label}: skipped ${stage.id} — ${reason}`
  }

  const runID = startRun(db, Number(request.id), stage.id, stage.agent, stage.role)
  let sessionID: string | undefined

  try {
    const created = await session.create({
      title: `${stage.title} · ${label}`,
      location: { directory: path },
      model,
      metadata: DAEMON_SESSION_METADATA,
    })
    sessionID = created.id

    await session.switchAgent({ sessionID, agent: stage.agent })
    markRunning(db, runID, sessionID)
    writeRunEvent(
      db,
      logger,
      {
        id: runID,
        request_id: Number(request.id),
        stage: stage.id,
        agent: stage.agent,
        session_id: sessionID,
      },
      'stage.started',
      next.reason
    )

    await session.prompt({
      sessionID,
      text: stagePrompt(db, stage, request),
      metadata: DAEMON_PROMPT_METADATA,
    })

    return `${label}: started ${stage.id} (${stage.agent}) in ${sessionID}`
  } catch (error) {
    const reason = `could not start ${stage.id}: ${message(error)}`
    finishRun(db, runID, 'failed', reason)
    writeRunEvent(
      db,
      logger,
      {
        id: runID,
        request_id: Number(request.id),
        stage: stage.id,
        agent: stage.agent,
        session_id: sessionID ?? null,
      },
      'stage.failed',
      reason
    )
    ensureDecision(options, request, { stage: stage.id, agent: stage.agent }, reason, 'failed')

    if (sessionID && session.remove) {
      try {
        await session.remove({ sessionID })
      } catch {
        // The session may already be gone; the run row is the record that matters.
      }
    }

    logger.error(`daemon: ${reason}`, error)
    return `${label}: ${reason}`
  }
}

function transitionRequest(options: TickOptions, request: Row, next: TransitionStep): string {
  const label = `${pad(Number(request.id))} ${request.slug}`
  try {
    appendEvent(options.db, {
      request: request.id,
      type: `request.${next.state}`,
      actor: 'ai_0',
      state: next.state,
      payload: { reason: next.reason },
    })
    return `${label}: moved to ${next.state}`
  } catch (error) {
    const reason = `could not move the request to ${next.state}: ${message(error)}`
    ensureDecision(options, request, { stage: 'transition', agent: 'ai_0' }, reason, 'failed')
    return `${label}: ${reason}`
  }
}

// ---------------------------------------------------------------------------
// what a stage means
// ---------------------------------------------------------------------------

function stageSatisfied(db: Db, request: Row, stage: string): boolean {
  return stageCompleted(db, Number(request.id), stage)
}

function failureReason(db: Db, request: Row, stage: string, outcome: string): string {
  const lead =
    outcome === 'interrupted'
      ? `The ${stage} agent was interrupted.`
      : `The ${stage} agent finished without completing its stage.`

  const progress = db
    .prepare(
      'SELECT blocked_on, next_step FROM progress WHERE request_id = ? AND stage_id = ? ORDER BY n DESC LIMIT 1'
    )
    .get(request.id, stage)
  if (progress?.blocked_on) return `${lead} Last progress blocked on: ${progress.blocked_on}.`
  if (progress?.next_step) return `${lead} Last progress next step: ${progress.next_step}.`

  return lead
}

function retryAllowed(db: Db, run: RunRow): boolean {
  const at = run.finished_at ?? run.created_at
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM decisions
          WHERE request_id = ? AND resolved_at IS NOT NULL AND resolved_at > ?
          LIMIT 1`
      )
      .get(run.request_id, at)
  )
}

// ---------------------------------------------------------------------------
// decisions + events
// ---------------------------------------------------------------------------

function ensureRunDecision(options: TickOptions, run: RunWithRequest, reason: string): void {
  const request = options.db.prepare('SELECT * FROM requests WHERE id = ?').get(run.request_id) as
    Row | undefined
  if (!request) return

  ensureDecision(options, request, { stage: run.stage, agent: run.agent }, reason, 'failed')
}

function ensureDecision(
  options: TickOptions,
  request: Row,
  next: { stage: string; agent: string },
  reason: string,
  kind: 'failed' | 'blocked'
): void {
  if (hasOpenDecision(options.db, Number(request.id))) return

  try {
    decide(options.db, {
      request: Number(request.id),
      kind,
      question: `${pad(Number(request.id))} ${request.slug}: ${reason} Retry, or should this be cancelled?`,
      recommendation: 'retry',
      evidence: `stage=${next.stage} agent=${next.agent} state=${request.state}`,
      reversible: true,
      default_if_silent: 'block',
    })
  } catch (error) {
    options.logger.error(`daemon: could not open a decision for request ${request.id}`, error)
  }
}

function writeRunEvent(
  db: Db,
  logger: DaemonLogger,
  run: Pick<RunRow, 'id' | 'request_id' | 'stage' | 'agent' | 'session_id'>,
  type: string,
  reason?: string
): void {
  try {
    appendEvent(db, {
      request: run.request_id,
      type,
      actor: 'ai_0',
      payload: {
        stage: run.stage,
        agent: run.agent,
        run: run.id,
        session: run.session_id,
        ...(reason ? { reason } : {}),
      },
    })
  } catch (error) {
    logger.error(`daemon: could not write ${type} for run ${run.id}`, error)
  }
}

// ---------------------------------------------------------------------------
// request records
// ---------------------------------------------------------------------------

/**
 * Commit the generated record once the judge closes a request. The docs agent
 * owns canonical docs; this step owns the per-request audit record, so a close
 * does not leave an untracked file behind.
 */
function commitClosedRecords(options: TickOptions): void {
  const rows = options.db
    .prepare(
      `SELECT f.*, w.path AS workspace_path
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state IN ('completed', 'cancelled')
          AND f.closed_at IS NOT NULL
          AND f.record_path IS NOT NULL
          AND f.record_committed_at IS NULL
        ORDER BY f.id`
    )
    .all()

  for (const request of rows) {
    const path = String(request.record_path)
    const directory = String(request.workspace_path)
    if (!existsSync(path)) continue

    try {
      execFileSync('git', ['add', '--', path], { cwd: directory, stdio: 'ignore' })
      const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--', path], {
        cwd: directory,
        encoding: 'utf8',
      })
      if (staged.trim()) {
        const subject = `docs(record): close ${pad(Number(request.id))} ${request.slug}`
        const body =
          `Record the final state and checkpoint history for request ${request.id}.\n\n` +
          'Co-authored-by: OpenCode <noreply@opencode.ai>'
        execFileSync('git', ['commit', '-m', subject, '-m', body, '--', path], {
          cwd: directory,
          stdio: 'ignore',
        })
        options.logger.info(`record committed: ${subject}`)
      }
      options.db
        .prepare('UPDATE requests SET record_committed_at = ? WHERE id = ?')
        .run(new Date().toISOString(), request.id)
      recordCommitFailures.delete(Number(request.id))
    } catch (error) {
      if (!recordCommitFailures.has(Number(request.id))) {
        recordCommitFailures.add(Number(request.id))
        options.logger.error(
          `could not commit the request record for ${pad(Number(request.id))} ${request.slug}`,
          error
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// handoff text
// ---------------------------------------------------------------------------

function stagePrompt(db: Db, stage: StageStep['stage'], request: Row): string {
  const pipeline = pipelineForRequest(db, request)
  const workspace = workspaceOf(db, request)
  const head =
    `Clara daemon: request ${pad(Number(request.id))} "${request.slug}" in ${workspace.path}. ` +
    `Pipeline ${pipeline.id}@${pipeline.version}, stage ${stage.id} (${stage.title}). ` +
    `Read the ledger first with clara_ask (request ${request.id}); this message is only the handoff.`
  return `${head}\n\n${renderInstructions(stage, pipeline, request, workspace)}`
}
