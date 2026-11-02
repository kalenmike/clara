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
import { appendEvent, decide, tick as ledgerTick, workspaceOf } from './queries.ts'
import {
  acquireDaemonLock,
  activeFeatures,
  finishRun,
  hasCriteria,
  hasOpenDecision,
  latestRun,
  markRunning,
  nextStage,
  releaseDaemonLock,
  startRun,
  waitingRuns,
  type NextStage,
  type RunRow,
  type RunWithFeature,
  type Stage,
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

  for (const feature of activeFeatures(options.db)) {
    if (spawned >= options.maxSpawns) break
    if (feature.stalled_at) continue
    if (hasOpenDecision(options.db, Number(feature.id))) continue

    const next = nextStage(options.db, feature)
    if (!next) continue

    const latest = latestRun(options.db, Number(feature.id), next.stage)
    if (latest && (latest.status === 'starting' || latest.status === 'running')) continue

    if (latest && latest.status === 'done') {
      ensureDecision(
        options,
        feature,
        next,
        `The ${next.stage} stage is recorded done but the ledger still asks for it.`,
        'blocked'
      )
      continue
    }

    if (latest && (latest.status === 'failed' || latest.status === 'interrupted')) {
      if (!retryAllowed(options.db, latest)) {
        ensureDecision(
          options,
          feature,
          next,
          `The ${next.stage} stage failed and is waiting for a resolved decision.`,
          'blocked'
        )
        continue
      }
    }

    if (next.stage === 'build' && feature.state === 'planned') {
      try {
        appendEvent(options.db, {
          feature: feature.id,
          type: 'build.started',
          actor: 'ai_0',
          state: 'building',
          payload: { stage: 'build', reason: next.reason },
        })
      } catch (error) {
        ensureDecision(
          options,
          feature,
          next,
          `Could not move the feature to building: ${message(error)}`,
          'failed'
        )
        continue
      }
      feature.state = 'building'
    }

    actions.push(await spawnStage(options, feature, next))
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
    const terminal = run.feature_state === 'done' || run.feature_state === 'scrapped'

    if (!run.session_id) {
      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'feature closed before the stage started')
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
        finishRun(options.db, run.id, 'interrupted', 'feature closed before the stage finished')
        continue
      }

      const feature = options.db
        .prepare('SELECT * FROM features WHERE id = ?')
        .get(run.feature_id) as Row

      if (info.outcome === 'succeeded' && stageSatisfied(options.db, feature, run.stage)) {
        finishRun(options.db, run.id, 'done', 'stage completed')
        writeRunEvent(options.db, options.logger, run, 'stage.done')
        continue
      }

      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'feature closed before the stage finished')
        continue
      }

      const status = info.outcome === 'interrupted' ? 'interrupted' : 'failed'
      const reason = failureReason(options.db, feature, run.stage, info.outcome)
      finishRun(options.db, run.id, status, reason)
      writeRunEvent(
        options.db,
        options.logger,
        run,
        run.stage === 'build' ? 'ci.failed' : 'stage.failed',
        reason
      )
      ensureRunDecision(options, run, reason)
    } catch (error) {
      if (terminal) {
        finishRun(options.db, run.id, 'interrupted', 'feature closed before the stage finished')
        continue
      }
      const reason = `session ${run.session_id} could not be read: ${message(error)}`
      finishRun(options.db, run.id, 'failed', reason)
      writeRunEvent(options.db, options.logger, run, 'stage.failed', reason)
      ensureRunDecision(options, run, reason)
    }
  }
}

async function spawnStage(options: TickOptions, feature: Row, next: NextStage): Promise<string> {
  const { db, ctx, logger } = options
  const session = sessionApi(ctx)
  if (!session) return 'daemon: session API unavailable'

  const label = `${pad(Number(feature.id))} ${feature.slug}`
  const workspace = workspaceOf(db, feature)
  const path = String(workspace.path)

  if (!existsSync(path)) {
    const reason = `workspace path ${path} does not exist`
    ensureDecision(options, feature, next, reason, 'blocked')
    return `${label}: skipped ${next.stage} — ${reason}`
  }

  const model = await resolveModel(ctx, path)
  if (!model) {
    const reason =
      'no model is available for a worker session; set daemonModel or submit from a session with a model'
    ensureDecision(options, feature, next, reason, 'blocked')
    return `${label}: skipped ${next.stage} — ${reason}`
  }

  const runID = startRun(db, Number(feature.id), next.stage, next.agent)
  let sessionID: string | undefined

  try {
    const created = await session.create({
      title: `${stageLabel(next.stage)} · ${label}`,
      location: { directory: path },
      model,
      metadata: DAEMON_SESSION_METADATA,
    })
    sessionID = created.id

    await session.switchAgent({ sessionID, agent: next.agent })
    markRunning(db, runID, sessionID)
    writeRunEvent(
      db,
      logger,
      {
        id: runID,
        feature_id: Number(feature.id),
        stage: next.stage,
        agent: next.agent,
        session_id: sessionID,
      },
      'stage.started',
      next.reason
    )

    await session.prompt({
      sessionID,
      text: stagePrompt(next.stage, feature, path),
      metadata: DAEMON_PROMPT_METADATA,
    })

    return `${label}: started ${next.stage} (${next.agent}) in ${sessionID}`
  } catch (error) {
    const reason = `could not start ${next.stage}: ${message(error)}`
    finishRun(db, runID, 'failed', reason)
    writeRunEvent(
      db,
      logger,
      {
        id: runID,
        feature_id: Number(feature.id),
        stage: next.stage,
        agent: next.agent,
        session_id: sessionID ?? null,
      },
      'stage.failed',
      reason
    )
    ensureDecision(options, feature, next, reason, 'failed')

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

// ---------------------------------------------------------------------------
// what a stage means
// ---------------------------------------------------------------------------

function stageSatisfied(db: Db, feature: Row, stage: Stage): boolean {
  switch (stage) {
    case 'spec':
      return hasCriteria(db, Number(feature.id))
    case 'test':
      return Boolean(feature.tests_hash)
    case 'build':
      return ['review', 'done', 'scrapped'].includes(String(feature.state))
    case 'docs':
      // The docs agent has no ledger mutation of its own. A successful session
      // is the completion signal; the close gate still belongs to judge.
      return true
    case 'judge':
      return ['done', 'scrapped'].includes(String(feature.state))
  }
}

function failureReason(db: Db, feature: Row, stage: Stage, outcome: string): string {
  const lead =
    outcome === 'interrupted'
      ? `The ${stage} agent was interrupted.`
      : `The ${stage} agent finished without completing its stage.`

  if (stage === 'build') {
    const checkpoint = db
      .prepare(
        'SELECT blocked_on, next_step FROM checkpoints WHERE feature_id = ? ORDER BY n DESC LIMIT 1'
      )
      .get(feature.id)
    if (checkpoint?.blocked_on)
      return `${lead} Last checkpoint blocked on: ${checkpoint.blocked_on}.`
    if (checkpoint?.next_step) return `${lead} Last checkpoint next step: ${checkpoint.next_step}.`
  }

  return lead
}

function retryAllowed(db: Db, run: RunRow): boolean {
  const at = run.finished_at ?? run.created_at
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM decisions
          WHERE feature_id = ? AND resolved_at IS NOT NULL AND resolved_at > ?
          LIMIT 1`
      )
      .get(run.feature_id, at)
  )
}

// ---------------------------------------------------------------------------
// decisions + events
// ---------------------------------------------------------------------------

function ensureRunDecision(options: TickOptions, run: RunWithFeature, reason: string): void {
  const feature = options.db.prepare('SELECT * FROM features WHERE id = ?').get(run.feature_id) as
    Row | undefined
  if (!feature) return

  ensureDecision(options, feature, { stage: run.stage, agent: run.agent, reason }, reason, 'failed')
}

function ensureDecision(
  options: TickOptions,
  feature: Row,
  next: NextStage,
  reason: string,
  kind: 'failed' | 'blocked'
): void {
  if (hasOpenDecision(options.db, Number(feature.id))) return

  try {
    decide(options.db, {
      feature: Number(feature.id),
      kind,
      question: `${pad(Number(feature.id))} ${feature.slug}: ${reason} Retry, or should this be scrapped?`,
      recommendation: 'retry',
      evidence: `stage=${next.stage} agent=${next.agent} state=${feature.state}`,
      reversible: true,
      default_if_silent: 'block',
    })
  } catch (error) {
    options.logger.error(`daemon: could not open a decision for feature ${feature.id}`, error)
  }
}

function writeRunEvent(
  db: Db,
  logger: DaemonLogger,
  run: Pick<RunRow, 'id' | 'feature_id' | 'stage' | 'agent' | 'session_id'>,
  type: string,
  reason?: string
): void {
  try {
    appendEvent(db, {
      feature: run.feature_id,
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
// feature records
// ---------------------------------------------------------------------------

/**
 * Commit the generated record once the judge closes a feature. The docs agent
 * owns canonical docs; this step owns the per-feature audit record, so a close
 * does not leave an untracked file behind.
 */
function commitClosedRecords(options: TickOptions): void {
  const rows = options.db
    .prepare(
      `SELECT f.*, w.path AS workspace_path
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state IN ('done', 'scrapped')
          AND f.closed_at IS NOT NULL
          AND f.spec_path IS NOT NULL
          AND f.record_committed_at IS NULL
        ORDER BY f.id`
    )
    .all()

  for (const feature of rows) {
    const path = String(feature.spec_path)
    const directory = String(feature.workspace_path)
    if (!existsSync(path)) continue

    try {
      execFileSync('git', ['add', '--', path], { cwd: directory, stdio: 'ignore' })
      const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--', path], {
        cwd: directory,
        encoding: 'utf8',
      })
      if (staged.trim()) {
        const subject = `docs(record): close ${pad(Number(feature.id))} ${feature.slug}`
        const body =
          `Record the final state and checkpoint history for feature ${feature.id}.\n\n` +
          'Co-authored-by: OpenCode <noreply@opencode.ai>'
        execFileSync('git', ['commit', '-m', subject, '-m', body, '--', path], {
          cwd: directory,
          stdio: 'ignore',
        })
        options.logger.info(`record committed: ${subject}`)
      }
      options.db
        .prepare('UPDATE features SET record_committed_at = ? WHERE id = ?')
        .run(new Date().toISOString(), feature.id)
      recordCommitFailures.delete(Number(feature.id))
    } catch (error) {
      if (!recordCommitFailures.has(Number(feature.id))) {
        recordCommitFailures.add(Number(feature.id))
        options.logger.error(
          `could not commit the feature record for ${pad(Number(feature.id))} ${feature.slug}`,
          error
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// handoff text
// ---------------------------------------------------------------------------

function stageLabel(stage: Stage): string {
  switch (stage) {
    case 'spec':
      return 'Spec'
    case 'test':
      return 'Test'
    case 'build':
      return 'Build'
    case 'docs':
      return 'Docs'
    case 'judge':
      return 'Judge'
  }
}

function stagePrompt(stage: Stage, feature: Row, path: string): string {
  const head = `Clara daemon: feature ${pad(Number(feature.id))} "${feature.slug}" in ${path}. Read the ledger first with clara_ask (feature ${feature.id}); this message is only the handoff.`

  switch (stage) {
    case 'spec':
      return `${head}\n\nPropose the acceptance criteria with clara_criteria. Every criterion needs a test_path or human_gate=true. Do not read source code; use the feature record and the docs it points at. Call clara_criteria before you run out of steps, then stop. A human must approve.`
    case 'test':
      return `${head}\n\nWrite the tests that define done for the approved criteria. Use clara_ask to read them. Freeze the suite with clara_freeze and record the hash. Do not edit source.`
    case 'build':
      return `${head}\n\nImplement the feature against the frozen tests. Use clara_checkpoint at each boundary. Do not edit tests. When complete, call clara_event with type "build.review" and state "review". If a kill criterion fires, write a checkpoint with blocked_on and stop.`
    case 'docs':
      return `${head}\n\nApply the feature's docs_impact to the workspace docs. Never edit docs/features or docs/index.md. If the impact no longer applies cleanly, reconcile against current truth and record it. If you cannot reconcile, open a decision with clara_decide and stop.`
    case 'judge':
      return `${head}\n\nClose only from ledger evidence: call clara_ask once and check tests, docs, and human gates. Do not read source or run commands; there is no shell and the close gate does not re-hash. If every gate is recorded and the docs stage is done, call clara_event with type "feature.done" and state "done". Otherwise open one decision with clara_decide and stop. Do not write code.`
  }
}
