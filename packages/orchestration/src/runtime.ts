import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  budgetExceeded,
  computeBudget,
  emptyUsage,
  evaluatePolicy,
  isControlTool,
  remainingBudget,
  type EffectiveBudget,
  type Limits,
  type PolicyCheck,
  type PolicyDecision,
  type StepPolicy,
  type Usage,
} from '@clara/policy'
import { analyzeDatabase, type DiagnosticsOptions, type DiagnosticsReport } from './diagnostics.ts'
import { compileRun, loadCatalog } from './loader.ts'
import type { CompiledNode, LoadedCatalog, ScriptSpec } from './types.ts'
import {
  now,
  type AlertRow,
  type DeliveryClaimResult,
  type RunRow,
  type StepAttemptRow,
  type StepRow,
  Store,
} from './store.ts'

export interface Origin {
  session_id?: string | null
  harness?: string | null
  agent?: string | null
  kind?: 'human' | 'agent' | 'api' | 'worker'
}

export interface StartInput {
  prompt: string
  workspace: string
  target?: string
  /** Only claim work this caller can execute; omitted means no filtering. */
  capabilities?: string[]
  origin?: Origin
  parent_run_id?: number
  parent_step_path?: string
}

export interface StartResult {
  run: RunRow
  work: WorkOrder[]
}

export interface WorkOrder {
  run_id: number
  step_path: string
  name: string
  kind: string
  /** Rendered model prompt. Absent on script work orders. */
  prompt?: string
  workspace: string
  work_token: string
  attempt: number
  max_attempts: number
  model?: string
  provider?: string
  policy?: StepPolicy
  limits?: Limits
  budget?: EffectiveBudget
  enforcement: string
  background: boolean
  /** Deterministic payload. Present only on a script work order. */
  script?: ScriptSpec
  routes?: Array<{ when: string; run: string; criteria?: string; description?: string }>
  /** Present on a retry: why the previous attempt ended and what it produced. */
  retry?: { attempt: number; error: string; result: unknown }
  context: {
    prompt: string
    inputs: Array<{ label: string; path: string; name: string; result: unknown }>
    artifacts: Array<{ label: string; path: string; exists?: boolean }>
    /** Present on a recovery step: the attempt that handed off to it. */
    failure?: { step: string; attempt: number; error?: string; result?: unknown }
  }
}

export interface StatusResult {
  run: RunRow
  steps: StepRow[]
  alerts: AlertRow[]
  children: RunRow[]
}

export interface AdvanceResult {
  run: RunRow
  ready: StepRow[]
}

export interface RuntimeOptions {
  store: Store
  configPath?: string
  stdDir?: string
  leaseMs?: number
  stalledMs?: number
  adapterStaleMs?: number
  /** How long a ready script step waits for a runner before it alerts. */
  runnerWaitMs?: number
}

interface NodeSync {
  status: 'ready' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed'
}

const DONE = new Set(['done', 'skipped'])
const GLOB_CHARS = /[*?[\]{}]/

function isLiteralPath(path: string): boolean {
  return !GLOB_CHARS.test(path)
}
const LIVE = new Set(['pending', 'ready', 'running', 'waiting_children', 'recovering'])

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function ageMs(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY
}

const HANDOFF_LIMIT = 2_000

/** Every executable leaf: agents, routers, and scripts. Containers are skipped. */
function compiledLeaves(node: CompiledNode, out: CompiledNode[] = []): CompiledNode[] {
  if (node.kind === 'agent' || node.kind === 'router' || node.kind === 'script') out.push(node)
  for (const child of node.children ?? []) compiledLeaves(child, out)
  for (const child of node.onFailure?.children ?? []) compiledLeaves(child, out)
  for (const route of node.routes ?? []) {
    if (route.target) compiledLeaves(route.target, out)
  }
  return out
}

/** The capabilities an executor must advertise to run this leaf. */
export function nodeCapabilities(node: CompiledNode): string[] {
  const kind =
    node.kind === 'script'
      ? 'script'
      : node.kind === 'agent' || node.kind === 'router'
        ? 'agent'
        : undefined
  return [...(kind ? [kind] : []), ...(node.requires?.capabilities ?? [])]
}

export interface ClaimFilter {
  /** Capabilities the claimant advertises. Undefined means no filtering. */
  capabilities?: string[]
  /** Limit claims to the leaves this role executes. */
  role?: 'harness' | 'runner'
  /**
   * Harness identity for agent and router work. Script work is deliberately
   * not harness-scoped so one runner can serve every harness in the workspace.
   */
  harness?: string
  /** Runner identity, used to satisfy a step's `requires.runner`. */
  runner?: { id: string; labels: string[] }
}

function canRun(node: CompiledNode, run: RunRow, filter?: ClaimFilter): boolean {
  if (!filter) return true
  if (filter.role === 'runner' && node.kind !== 'script') return false
  if (filter.role === 'harness' && node.kind !== 'agent' && node.kind !== 'router') return false
  if (
    filter.capabilities &&
    !nodeCapabilities(node).every((cap) => filter.capabilities?.includes(cap))
  ) {
    return false
  }
  if (filter.harness) {
    // A harness adapter never owns deterministic script work.
    if (node.kind === 'script') return false
    // An explicit `requires.adapter` pins the executor even when the run was
    // started from a different harness; otherwise the origin harness owns it.
    const required = node.requires?.adapter
    if (required) {
      if (required !== filter.harness) return false
    } else if (run.origin_harness && run.origin_harness !== filter.harness) {
      return false
    }
  }
  const required = node.requires?.runner
  if (!required) return true
  if (!filter.runner) return false
  return filter.runner.id === required || filter.runner.labels.includes(required)
}

// Keep a blocked worker's partial result short enough to store and render in
// the next attempt's prompt without turning a failure into a context bomb.
function handoffText(result: unknown): string {
  if (result === null || result === undefined) return ''
  const raw = typeof result === 'string' ? result : JSON.stringify(result)
  const text = String(raw ?? '').trim()
  return text.length > HANDOFF_LIMIT ? `${text.slice(0, HANDOFF_LIMIT)}…` : text
}

export class OrchestrationErrorWithCode extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OrchestrationErrorWithCode'
    this.code = code
  }
}

export class Runtime {
  readonly store: Store
  private readonly configPath?: string
  private readonly stdDir?: string
  private readonly leaseMs: number
  private readonly stalledMs: number
  private readonly adapterStaleMs: number
  private readonly runnerWaitMs: number
  private catalogCache = new Map<string, { at: number; catalog: LoadedCatalog }>()
  /**
   * Completed attempts remember their work token for a short window. A worker
   * can report the final model turn after it recorded its result because the
   * harness closes the step before the turn's usage event arrives.
   */
  private completedUsage = new Map<number, { token: string; expires: number }>()

  constructor(options: RuntimeOptions) {
    this.store = options.store
    this.configPath = options.configPath
    this.stdDir = options.stdDir
    this.leaseMs = options.leaseMs ?? 30 * 60_000
    this.stalledMs = options.stalledMs ?? 5 * 60_000
    this.adapterStaleMs = options.adapterStaleMs ?? 120_000
    this.runnerWaitMs = options.runnerWaitMs ?? 60_000
  }

  configFor(workspace: string): string {
    const local = join(workspace, 'orchestration', 'index.yml')
    if (existsSync(local)) return resolve(local)
    if (this.configPath) return resolve(this.configPath)
    throw new OrchestrationErrorWithCode(
      'config_missing',
      `No orchestration config found for ${workspace}. Expected ${local} or a configured default.`
    )
  }

  catalogFor(workspace: string): LoadedCatalog {
    const path = this.configFor(workspace)
    const cached = this.catalogCache.get(path)
    if (cached) return cached.catalog
    const catalog = loadCatalog(path, this.stdDir ? { stdDir: this.stdDir } : {})
    this.catalogCache.set(path, { at: Date.now(), catalog })
    return catalog
  }

  clearCatalogCache(): void {
    this.catalogCache.clear()
  }

  start(input: StartInput): StartResult {
    if (!input.prompt.trim())
      throw new OrchestrationErrorWithCode('prompt_empty', 'prompt is required')
    const workspace = resolve(input.workspace)
    const catalog = this.catalogFor(workspace)
    const target = input.target ?? input.parent_run_id ?? catalog.root.manifest.id
    const compiled = compileRun(catalog, input.target)
    const enforcement = compiled.root.enforcement ?? 'observed'
    if (enforcement === 'strict') this.assertAdapter(workspace, compiled.root)
    const rootRunID = input.parent_run_id ?? 0
    let run = this.store.insertRun({
      workspace,
      prompt: input.prompt,
      target: String(target),
      root_run_id: rootRunID,
      parent_run_id: input.parent_run_id ?? null,
      parent_step_path: input.parent_step_path ?? null,
      origin_session_id: input.origin?.session_id ?? null,
      origin_harness: input.origin?.harness ?? null,
      origin_agent: input.origin?.agent ?? null,
      origin_kind: input.origin?.kind ?? 'human',
      pipeline_ref: compiled.root.name,
      snapshot: JSON.stringify(compiled.root),
      hash: compiled.hash,
      enforcement,
      notification: null,
    })
    if (!input.parent_run_id) {
      this.store.updateRun(Number(run.id), { root_run_id: Number(run.id) })
      run = this.store.run(Number(run.id)) as RunRow
    }
    this.store.event(Number(run.id), 'run.started', {
      target,
      pipeline: compiled.root.name,
      hash: compiled.hash,
      enforcement,
    })
    this.advance(Number(run.id))
    const harness = input.origin?.harness?.trim() || undefined
    // A caller that states its capabilities is an executor and must stay in its
    // own lane. A manual caller without a capability filter (Clara Lab, the
    // generic MCP surface) may claim any ready work order.
    const scopedHarness = harness && input.capabilities?.length ? harness : undefined
    const work = this.claim(
      Number(run.id),
      8,
      'dispatcher',
      input.capabilities || scopedHarness
        ? {
            ...(input.capabilities ? { capabilities: input.capabilities } : {}),
            ...(scopedHarness ? { harness: scopedHarness, role: 'harness' as const } : {}),
          }
        : undefined
    )
    return { run: this.store.run(Number(run.id)) as RunRow, work }
  }

  private assertAdapter(workspace: string, root: CompiledNode): void {
    const leaves = compiledLeaves(root)
    const needsAgent = leaves.some((leaf) => leaf.kind === 'agent' || leaf.kind === 'router')
    const needsScript = leaves.some((leaf) => leaf.kind === 'script')
    const extra = root.requires?.capabilities ?? []
    const harness = root.requires?.adapter
    const live = this.store
      .adapters(workspace)
      .filter((row) => ageMs(row.heartbeat_at) <= this.adapterStaleMs)
    const has = (role: 'harness' | 'runner', capabilities: string[]): boolean =>
      live.some((row) => {
        if (row.role !== role) return false
        if (harness && row.harness !== harness && role === 'harness') return false
        const parsed = parseJson<string[]>(row.capabilities, [])
        if (![...capabilities, ...extra].every((capability) => parsed.includes(capability))) {
          return false
        }
        const requiredRunner = root.requires?.runner
        if (role === 'runner' && requiredRunner) {
          const labels = parseJson<string[]>(row.labels, [])
          return row.id === requiredRunner || labels.includes(requiredRunner)
        }
        return true
      })
    if (needsAgent && !has('harness', ['tool_policy', 'turn_limit', 'token_limit'])) {
      throw new OrchestrationErrorWithCode(
        'enforcement_unavailable',
        `This pipeline requires strict enforcement; no live ${
          harness ?? 'harness'
        } adapter with tool_policy, turn_limit, token_limit is registered for ${workspace}.`
      )
    }
    if (needsScript && !has('runner', ['script'])) {
      throw new OrchestrationErrorWithCode(
        'enforcement_unavailable',
        `This pipeline requires strict enforcement; no live runner with script${
          root.requires?.runner ? ` (${root.requires.runner})` : ''
        } is registered for ${workspace}.`
      )
    }
  }

  advance(runID: number, limit = 1): AdvanceResult {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (isTerminal(run)) return { run, ready: [] }
    const root = JSON.parse(run.snapshot) as CompiledNode
    const steps = new Map(this.store.steps(runID).map((step) => [step.path, step]))
    const ready: StepRow[] = []

    const ensure = (node: CompiledNode, parentPath: string | null): StepRow => {
      const row = this.store.ensureStep(run, {
        path: node.path,
        parent_path: parentPath,
        name: node.name,
        type: node.kind,
        ...(node.prompt ? { prompt: node.prompt } : {}),
        ...(node.model ? { model: node.model } : {}),
        ...(node.provider ? { provider: node.provider } : {}),
        ...(node.policy ? { policy: node.policy } : {}),
        ...(node.limits ? { limits: node.limits } : {}),
        ...(node.background ? { background: true } : {}),
        max_attempts: node.retries?.auto_attempts ?? 3,
      })
      steps.set(row.path, row)
      return row
    }

    const mark = (row: StepRow, fields: Partial<Record<string, unknown>>): StepRow => {
      this.store.updateStep(Number(row.id), fields)
      const updated = this.store.step(runID, row.path) as StepRow
      steps.set(row.path, updated)
      return updated
    }

    const readyStep = (row: StepRow, node: CompiledNode, schedule: boolean): NodeSync => {
      if (row.status === 'pending') {
        // Only the first live child in a sequential group is promoted; later
        // siblings are inspected read-only so a failed branch still fails fast.
        if (!schedule || ready.length >= limit) return { status: 'waiting' }
        const updated = mark(row, { status: 'ready' })
        this.store.event(
          runID,
          'step.ready',
          {
            step: node.path,
            name: node.name,
            kind: node.kind,
            background: Boolean(node.background),
          },
          row.current_attempt_id
        )
        ready.push(updated)
        return { status: 'ready' }
      }
      if (row.status === 'ready') {
        ready.push(row)
        return { status: 'ready' }
      }
      if (row.status === 'running' || row.status === 'waiting_children')
        return { status: 'running' }
      if (row.status === 'failed') return { status: 'failed' }
      if (row.status === 'done' || row.status === 'skipped') return { status: 'done' }
      return { status: 'waiting' }
    }

    const beginRecovery = (node: CompiledNode, row: StepRow, schedule: boolean): NodeSync => {
      const recovery = node.onFailure
      if (!recovery) return { status: 'failed' }
      for (const child of recovery.children) ensure(child, node.path)
      const cycle = Number(row.recovery_cycles) + 1
      const updated = mark(row, {
        status: 'recovering',
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
      this.store.event(
        runID,
        'step.recovering',
        { step: node.path, cycle, error: updated.error },
        updated.current_attempt_id
      )
      return syncRecovery(node, updated, schedule)
    }

    const syncRecovery = (node: CompiledNode, row: StepRow, schedule: boolean): NodeSync => {
      const recovery = node.onFailure
      if (!recovery) return { status: 'failed' }
      let blocked = false
      let failedChild: CompiledNode | undefined
      for (const child of recovery.children) {
        const result = sync(child, node.path, schedule && !blocked)
        if (result.status === 'failed') {
          failedChild = child
          break
        }
        if (result.status !== 'done') blocked = true
      }
      if (failedChild) {
        const childRow = steps.get(failedChild.path)
        const detail = childRow?.error ? `: ${childRow.error}` : ''
        const combined = `${
          row.error ? `${row.error}; ` : ''
        }recovery failed at ${failedChild.name}${detail}`
        mark(row, {
          status: 'failed',
          error: combined,
          finished_at: now(),
          lease_id: null,
          lease_owner: null,
          lease_expires_at: null,
        })
        this.store.event(
          runID,
          'step.recovery_failed',
          { step: node.path, cycle: Number(row.recovery_cycles) + 1, error: combined },
          row.current_attempt_id
        )
        const alert = this.store.alert({
          run_id: runID,
          step_path: node.path,
          kind: 'recovery_failed',
          title: `Recovery failed: ${node.name}`,
          body: combined,
        })
        this.store.event(
          runID,
          'alert.created',
          { alert: alert.id, kind: 'recovery_failed' },
          row.current_attempt_id
        )
        return { status: 'failed' }
      }
      if (blocked) return { status: 'running' }

      const cycle = Number(row.recovery_cycles) + 1
      const results = recovery.children.map((child) => {
        const childRow = steps.get(child.path)
        return {
          name: child.name,
          path: child.path,
          result: parseJson<unknown>(childRow?.result, null),
        }
      })
      if (recovery.retry) {
        const updated = mark(row, {
          status: 'ready',
          recovery_cycles: cycle,
          finished_at: null,
          lease_id: null,
          lease_owner: null,
          lease_expires_at: null,
        })
        this.store.event(
          runID,
          'step.recovered',
          { step: node.path, cycle, retried: true },
          row.current_attempt_id
        )
        return readyStep(updated, node, schedule)
      }
      mark(row, {
        status: 'done',
        recovery_cycles: cycle,
        recovered: 1,
        recovered_by: recovery.children.at(-1)?.path ?? null,
        result: JSON.stringify({ recovered: true, steps: results }),
        finished_at: now(),
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
      this.store.event(
        runID,
        'step.recovered',
        { step: node.path, cycle, retried: false },
        row.current_attempt_id
      )
      return { status: 'done' }
    }

    const sync = (node: CompiledNode, parentPath: string | null, schedule: boolean): NodeSync => {
      const row = ensure(node, parentPath)

      if (
        node.onFailure &&
        (node.kind === 'agent' || node.kind === 'script' || node.kind === 'router')
      ) {
        if (row.status === 'recovering') return syncRecovery(node, row, schedule)
        if (row.status === 'failed') {
          if (Number(row.recovery_cycles) < node.onFailure.maxCycles) {
            return beginRecovery(node, row, schedule)
          }
          return { status: 'failed' }
        }
      }

      if (
        (node.kind === 'agent' || node.kind === 'router' || node.kind === 'script') &&
        node.inputs &&
        (row.status === 'pending' || row.status === 'ready')
      ) {
        const gate = this.inputGate(node, steps)
        if (gate === 'waiting') return { status: 'running' }
        if (gate === 'failed') {
          const label =
            Object.entries(node.inputs).find(([, inputPath]) => {
              const input = steps.get(inputPath)
              if (input?.result) return false
              return (
                !input ||
                input.status === 'failed' ||
                input.status === 'skipped' ||
                input.status === 'cancelled'
              )
            })?.[0] ?? 'unknown'
          const error = `input "${label}" is unavailable`
          mark(row, {
            status: 'failed',
            error,
            finished_at: now(),
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          this.store.event(
            runID,
            'step.failed',
            { step: node.path, reason: 'input_unavailable', input: label },
            row.current_attempt_id
          )
          return { status: 'failed' }
        }
      }

      if (node.kind === 'agent') {
        if (row.status === 'waiting_children') {
          const children = this.store.childRuns(runID, node.path)
          if (!children.length) {
            return { status: 'running' }
          }
          const failed = children.find(
            (child) => child.state === 'failed' || child.state === 'cancelled'
          )
          if (failed) {
            for (const child of children) {
              if (
                child.state === 'queued' ||
                child.state === 'running' ||
                child.state === 'waiting'
              ) {
                this.cancel(Number(child.id), 'fail_fast')
              }
            }
            this.store.transaction(() => {
              if (row.current_attempt_id !== null) {
                this.store.updateStepAttempt(Number(row.current_attempt_id), {
                  status: 'failed',
                  error: `child run ${failed.id} failed`,
                  finished_at: now(),
                })
              }
              mark(row, {
                status: 'failed',
                error: `child run ${failed.id} failed`,
                finished_at: now(),
                lease_id: null,
                lease_owner: null,
                lease_expires_at: null,
              })
              this.store.event(
                runID,
                'step.failed',
                {
                  step: node.path,
                  run: failed.id,
                  reason: 'fail_fast',
                },
                row.current_attempt_id
              )
            })
            return { status: 'failed' }
          }
          if (children.every((child) => child.state === 'completed')) {
            const results = children.map((child) => ({
              run_id: child.id,
              result: parseJson<unknown>(this.latestResult(Number(child.id)), null),
            }))
            this.store.transaction(() => {
              if (row.current_attempt_id !== null) {
                this.store.updateStepAttempt(Number(row.current_attempt_id), {
                  status: 'done',
                  result: JSON.stringify({ spawned: results }),
                  finished_at: now(),
                })
              }
              mark(row, {
                status: 'done',
                result: JSON.stringify({ spawned: results }),
                finished_at: now(),
              })
              this.store.event(
                runID,
                'step.completed',
                {
                  step: node.path,
                  spawned: children.map((c) => c.id),
                },
                row.current_attempt_id
              )
            })
            return { status: 'done' }
          }
          return { status: 'waiting' }
        }
        return readyStep(row, node, schedule)
      }

      if (node.kind === 'script') {
        if (row.status === 'failed') return { status: 'failed' }
        if (row.status === 'done' || row.status === 'skipped') return { status: 'done' }
        return readyStep(row, node, schedule)
      }

      if (node.kind === 'router') {
        if (row.status === 'done') {
          const result = parseJson<{ route?: string }>(row.result, {})
          if (!result.route) return { status: 'failed' }
          const route = node.routes?.find((candidate) => candidate.when === result.route)
          if (!route?.target) {
            return { status: 'failed' }
          }
          const target = sync(route.target, node.path, schedule)
          if (target.status === 'failed') {
            return { status: 'failed' }
          }
          if (
            target.status === 'ready' ||
            target.status === 'running' ||
            target.status === 'waiting'
          ) {
            return { status: 'running' }
          }
          return { status: 'done' }
        }
        if (row.status === 'failed') return { status: 'failed' }
        if (row.status === 'skipped') return { status: 'done' }
        return readyStep(row, node, schedule)
      }

      // pipeline / group
      if (row.status === 'failed') return { status: 'failed' }
      if (row.status === 'done' || row.status === 'skipped') return { status: 'done' }
      const children = node.children ?? []
      if (!children.length) {
        mark(row, { status: 'done', finished_at: now() })
        return { status: 'done' }
      }
      // Background children are prioritized, then foreground steps run in
      // declaration order. Inspect every child, even after a live one, so a
      // failure anywhere in the group is never hidden behind an earlier step.
      const ordered = [
        ...children.filter((child) => child.background),
        ...children.filter((child) => !child.background),
      ]
      let blocked = false
      let failedChild: CompiledNode | undefined
      for (const child of ordered) {
        const result = sync(child, node.path, schedule && !blocked)
        if (result.status === 'failed') {
          failedChild = child
          break
        }
        if (result.status !== 'done') blocked = true
      }

      if (failedChild) {
        mark(row, { status: 'failed', error: `${failedChild.name} failed`, finished_at: now() })
        return { status: 'failed' }
      }
      if (blocked) {
        mark(row, { status: 'running' })
        return { status: 'running' }
      }

      mark(row, { status: 'done', finished_at: now() })
      return { status: 'done' }
    }

    const result = sync(root, null, true)
    const latest = this.store.run(runID) as RunRow
    if (isTerminal(latest)) return { run: latest, ready: [] }
    if (result.status === 'failed') {
      const failedSteps = this.store
        .steps(runID)
        .filter((step) => step.status === 'failed' && step.error)
      // Prefer the leaf failure over the container summary it produced.
      const failedStep =
        failedSteps.find(
          (step) => step.type === 'agent' || step.type === 'router' || step.type === 'script'
        ) ?? failedSteps[0]
      const error = latest.error ?? failedStep?.error ?? 'pipeline failed'
      this.store.transaction(() => {
        this.store.updateRun(runID, { state: 'failed', finished_at: now(), error })
        this.store.event(runID, 'run.failed', { reason: error })
        this.settleRun(runID, 'parent_failed')
      })
    } else if (result.status === 'done') {
      this.store.updateRun(runID, { state: 'completed', finished_at: now() })
      const recoveries = this.store
        .steps(runID)
        .filter((step) => step.recovered === 1)
        .map((step) => ({
          step: step.path,
          cycles: Number(step.recovery_cycles),
          recovered_by: step.recovered_by,
        }))
      this.store.event(runID, 'run.completed', recoveries.length ? { recoveries } : {})
    } else {
      const state = ready.length ? 'running' : 'waiting'
      if (latest.state !== state) this.store.updateRun(runID, { state })
    }
    return { run: this.store.run(runID) as RunRow, ready }
  }

  /**
   * Close every live step when a run ends without completing. The step that
   * failed keeps its failure; interrupted work becomes cancelled and work that
   * never started becomes skipped. Clearing the lease here also rejects any
   * late worker call for the step.
   */
  private settleRun(runID: number, childReason: string): void {
    const at = now()
    for (const step of this.store.steps(runID)) {
      if (!LIVE.has(step.status)) continue
      const cancelled =
        step.status === 'running' ||
        step.status === 'waiting_children' ||
        step.status === 'recovering'
      if (cancelled && step.current_attempt_id !== null) {
        this.store.updateStepAttempt(Number(step.current_attempt_id), {
          status: 'cancelled',
          finished_at: at,
        })
      }
      this.store.updateStep(Number(step.id), {
        status: cancelled ? 'cancelled' : 'skipped',
        finished_at: at,
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
    }
    for (const child of this.store.db
      .prepare('SELECT * FROM runs WHERE parent_run_id = ?')
      .all(runID) as RunRow[]) {
      if (!isTerminal(child)) this.cancel(Number(child.id), childReason)
    }
  }

  private latestResult(runID: number): string | null {
    const steps = this.store.steps(runID)
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index].result) return steps[index].result
    }
    return null
  }

  private inputGate(node: CompiledNode, steps: Map<string, StepRow>): 'ok' | 'waiting' | 'failed' {
    let waiting = false
    for (const path of Object.values(node.inputs ?? {})) {
      const input = steps.get(path)
      if (!input) return 'failed'
      if (input.result) continue
      if (input.status === 'failed' || input.status === 'skipped' || input.status === 'cancelled')
        return 'failed'
      waiting = true
    }
    return waiting ? 'waiting' : 'ok'
  }

  claim(runID: number, limit = 1, owner = 'dispatcher', filter?: ClaimFilter): WorkOrder[] {
    const advanced = this.advance(runID, limit)
    const run = advanced.run
    const root = JSON.parse(run.snapshot) as CompiledNode
    const orders: WorkOrder[] = []
    for (const row of advanced.ready) {
      if (orders.length >= limit) break
      if (row.status !== 'ready') continue
      if (row.lease_id && ageMs(row.lease_expires_at) < this.leaseMs) continue
      const node = findNode(root, row.path)
      if (!node) continue
      if (!canRun(node, run, filter)) continue
      const token = randomUUID()
      const expires = new Date(Date.now() + this.leaseMs).toISOString()
      const attempt = Number(row.attempt) + 1
      const startedAt = now()
      let attemptID = 0
      this.store.transaction(() => {
        const attemptRow = this.store.insertStepAttempt({
          run_id: runID,
          step_path: row.path,
          attempt,
          status: 'running',
          model: row.model,
          provider: row.provider,
          started_at: startedAt,
        })
        attemptID = Number(attemptRow.id)
        this.store.updateStep(Number(row.id), {
          status: 'running',
          attempt,
          current_attempt_id: attemptID,
          // A new attempt gets a fresh budget and a clean live projection.
          // Carrying usage, results, errors, or the previous start time over
          // would make a retry start already exhausted or look finished.
          result: null,
          error: null,
          finished_at: null,
          turns: 0,
          tokens: 0,
          tool_calls: 0,
          violations: 0,
          lease_id: token,
          lease_owner: owner,
          lease_expires_at: expires,
          heartbeat_at: startedAt,
          started_at: startedAt,
        })
        this.store.event(runID, 'step.started', { step: row.path, attempt, owner }, attemptID)
      })
      const updated = this.store.step(runID, row.path) as StepRow
      orders.push(this.workOrder(run, updated, node, token))
    }
    if (orders.length) {
      this.store.updateRun(runID, { state: 'running' })
    }
    return orders
  }

  private failureContext(
    run: RunRow,
    path: string
  ): { step: string; attempt: number; error?: string; result?: unknown } | undefined {
    const parent = this.store.step(Number(run.id), path)
    if (!parent) return undefined
    const attempts = this.store.stepAttempts(Number(run.id), path)
    const latest = [...attempts]
      .reverse()
      .find((attempt) => attempt.error || attempt.status === 'failed' || attempt.status === 'retry')
    return {
      step: path,
      attempt: Number(latest?.attempt ?? parent.attempt),
      ...((latest?.error ?? parent.error) ? { error: String(latest?.error ?? parent.error) } : {}),
      ...(latest?.result ? { result: parseJson<unknown>(latest.result, null) } : {}),
    }
  }

  private workOrder(run: RunRow, row: StepRow, node: CompiledNode, token: string): WorkOrder {
    const policy = parseJson<StepPolicy | undefined>(row.policy, undefined)
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    const steps = new Map(this.store.steps(Number(run.id)).map((step) => [step.path, step]))
    const inputs = Object.entries(node.inputs ?? {}).flatMap(([label, path]) => {
      const input = steps.get(path)
      if (!input?.result) return []
      return [
        {
          label,
          path: input.path,
          name: input.name,
          result: parseJson<unknown>(input.result, null),
        },
      ]
    })
    const artifacts = Object.entries(node.artifacts ?? {}).map(([label, path]) => ({
      label,
      path,
      ...(isLiteralPath(path) ? { exists: existsSync(join(run.workspace, path)) } : {}),
    }))
    const previous =
      Number(row.attempt) > 1
        ? this.store.stepAttempt(Number(run.id), row.path, Number(row.attempt) - 1)
        : undefined
    const retry = previous?.error
      ? {
          attempt: Number(previous.attempt),
          error: previous.error,
          result: parseJson<unknown>(previous.result, null),
        }
      : undefined
    const script = node.kind === 'script'
    const failure = node.recoveryFor ? this.failureContext(run, node.recoveryFor) : undefined
    return {
      run_id: Number(run.id),
      step_path: node.path,
      name: node.name,
      kind: node.kind,
      ...(script
        ? { ...(node.script ? { script: node.script } : {}) }
        : { prompt: node.prompt ?? node.description ?? `Execute ${node.name}` }),
      workspace: run.workspace,
      work_token: token,
      attempt: Number(row.attempt),
      max_attempts: Number(row.max_attempts) + Number(row.recovery_cycles),
      ...(!script && node.model ? { model: node.model } : {}),
      ...(!script && node.provider ? { provider: node.provider } : {}),
      ...(!script && policy ? { policy } : {}),
      ...(limits ? { limits } : {}),
      ...(!script ? { budget } : {}),
      enforcement: node.enforcement ?? run.enforcement,
      background: Boolean(node.background),
      ...(node.kind === 'router' && node.routes
        ? {
            routes: node.routes.map((route) => ({
              when: route.when,
              run: route.run,
              ...(route.criteria ? { criteria: route.criteria } : {}),
              ...(route.description ? { description: route.description } : {}),
            })),
          }
        : {}),
      ...(retry ? { retry } : {}),
      context: {
        prompt: run.prompt,
        inputs,
        artifacts,
        ...(failure ? { failure } : {}),
      },
    }
  }

  next(runID: number, limit = 1, owner = 'mcp', filter?: ClaimFilter): WorkOrder[] {
    return this.claim(runID, limit, owner, filter)
  }

  /**
   * Claim work across the active runs of one workspace. A standalone runner
   * uses this instead of enumerating run ids; the filter keeps it from claiming
   * agent work it cannot execute.
   */
  claimWork(workspace: string, filter: ClaimFilter, limit = 1, owner = 'runner'): WorkOrder[] {
    const target = resolve(workspace)
    const orders: WorkOrder[] = []
    for (const run of this.store.activeRuns()) {
      if (orders.length >= limit) break
      if (resolve(run.workspace) !== target) continue
      orders.push(...this.claim(Number(run.id), limit - orders.length, owner, filter))
    }
    return orders
  }

  private requireRunningStep(
    runID: number,
    path: string,
    token: string
  ): { run: RunRow; row: StepRow } {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (isTerminal(run)) {
      throw new OrchestrationErrorWithCode('run_terminal', `run ${runID} is ${run.state}`)
    }
    const row = this.store.step(runID, path)
    if (!row) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    if (row.lease_id !== token) {
      throw new OrchestrationErrorWithCode('lease_invalid', `work token does not own ${path}`)
    }
    if (row.status !== 'running') {
      throw new OrchestrationErrorWithCode('step_not_running', `step ${path} is ${row.status}`)
    }
    return { run, row }
  }

  complete(
    runID: number,
    path: string,
    token: string,
    result: unknown,
    usage?: Partial<Usage>,
    exitCode?: number
  ): AdvanceResult {
    const { row } = this.requireRunningStep(runID, path, token)
    const turns = usage?.turns ?? Number(row.turns)
    const tokens = usage?.tokens ?? Number(row.tokens)
    const toolCalls = usage?.toolCalls ?? Number(row.tool_calls)
    const violations = usage?.violations ?? Number(row.violations)
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    const exceeded = budgetExceeded(budget, {
      turns,
      tokens,
      toolCalls,
      elapsedSeconds: row.started_at ? ageMs(row.started_at) / 1000 : 0,
      violations,
    })
    const attemptID = row.current_attempt_id
    const serialized = JSON.stringify(result ?? null)
    // A worker that was cut off by its budget reports a handoff, not a result.
    // When the step opts into `on_exhausted: fail`, retry it with a larger
    // budget instead of advancing the pipeline on partial work. The handoff is
    // kept on the attempt and surfaces as `retry` in the next work order.
    if (limits?.on_exhausted === 'fail' && attemptID !== null) {
      const attempt = this.store.stepAttempt(runID, path, Number(row.attempt))
      if (attempt?.budget_exhausted === 1) {
        const handoff = handoffText(result)
        if (handoff) this.store.updateStepAttempt(Number(attemptID), { result: serialized })
        const failed = this.fail(
          runID,
          path,
          token,
          `budget exhausted before the step finished${handoff ? `; handoff: ${handoff}` : ''}`,
          { turns, tokens, toolCalls, violations }
        )
        return { run: failed.run, ready: failed.ready }
      }
    }
    // A valid completion is final. A worker that reports a result has produced
    // work worth keeping, even when it had to exceed its budget to get there;
    // retrying would discard the result and run the step again. The overrun is
    // recorded on the completion event instead.
    this.store.transaction(() => {
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), {
          status: 'done',
          result: serialized,
          turns,
          tokens,
          tool_calls: toolCalls,
          violations,
          ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
          error: null,
          finished_at: now(),
        })
      }
      this.store.updateStep(Number(row.id), {
        status: 'done',
        result: serialized,
        turns,
        tokens,
        tool_calls: toolCalls,
        violations,
        finished_at: now(),
        error: null,
        ...(Number(row.recovery_cycles) > 0 ? { recovered: 1 } : {}),
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
      this.store.event(
        runID,
        'step.completed',
        {
          step: path,
          ...(exceeded ? { over_budget: exceeded } : {}),
        },
        attemptID
      )
    })
    this.rememberCompletedUsage(attemptID, token)
    return this.advance(runID)
  }

  fail(
    runID: number,
    path: string,
    token: string,
    error: string,
    usage?: Partial<Usage>,
    exitCode?: number
  ): { run: RunRow; retry: boolean; ready: StepRow[] } {
    const { run, row } = this.requireRunningStep(runID, path, token)
    const attempt = Number(row.attempt)
    const maxAttempts = Number(row.max_attempts) + Number(row.recovery_cycles)
    const node = findNode(JSON.parse(run.snapshot) as CompiledNode, path)
    const recoveryArmed = Boolean(
      node?.onFailure && Number(row.recovery_cycles) < node.onFailure.maxCycles
    )
    const attemptID = row.current_attempt_id
    const fields = {
      turns: usage?.turns ?? Number(row.turns),
      tokens: usage?.tokens ?? Number(row.tokens),
      tool_calls: usage?.toolCalls ?? Number(row.tool_calls),
      violations: usage?.violations ?? Number(row.violations),
    }
    if (attempt < maxAttempts) {
      this.store.transaction(() => {
        if (attemptID !== null) {
          this.store.updateStepAttempt(Number(attemptID), {
            ...fields,
            status: 'retry',
            error,
            ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
            finished_at: now(),
          })
        }
        this.store.updateStep(Number(row.id), {
          ...fields,
          status: 'ready',
          error,
          lease_id: null,
          lease_owner: null,
          lease_expires_at: null,
          finished_at: null,
        })
        this.store.event(runID, 'step.retry', { step: path, attempt, error }, attemptID)
      })
      this.rememberCompletedUsage(attemptID, token)
      const advanced = this.advance(runID)
      return { run: advanced.run, retry: true, ready: advanced.ready }
    }
    this.store.transaction(() => {
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), {
          ...fields,
          status: 'failed',
          error,
          ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
          finished_at: now(),
        })
      }
      this.store.updateStep(Number(row.id), {
        ...fields,
        status: 'failed',
        error,
        finished_at: now(),
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
      this.store.event(runID, 'step.failed', { step: path, attempt, error }, attemptID)
      if (!recoveryArmed && !node?.recoveryFor) {
        const alert = this.store.alert({
          run_id: runID,
          step_path: path,
          kind: 'failure',
          title: `Step failed: ${row.name}`,
          body: error,
        })
        this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'failure' }, attemptID)
      }
    })
    this.rememberCompletedUsage(attemptID, token)
    const advanced = this.advance(runID)
    return { run: advanced.run, retry: false, ready: advanced.ready }
  }

  route(runID: number, path: string, token: string, route: string): AdvanceResult {
    const { row } = this.requireRunningStep(runID, path, token)
    const run = this.store.run(runID) as RunRow
    const root = JSON.parse(run.snapshot) as CompiledNode
    const node = findNode(root, path)
    if (!node || node.kind !== 'router') {
      throw new OrchestrationErrorWithCode('not_router', `${path} is not a router`)
    }
    if (!node.routes?.some((candidate) => candidate.when === route)) {
      throw new OrchestrationErrorWithCode(
        'route_invalid',
        `route ${route} is not available; expected ${node.routes?.map((item) => item.when).join(', ')}`
      )
    }
    const attemptID = row.current_attempt_id
    const serialized = JSON.stringify({ route })
    this.store.transaction(() => {
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), {
          status: 'done',
          result: serialized,
          finished_at: now(),
        })
      }
      this.store.updateStep(Number(row.id), {
        status: 'done',
        result: serialized,
        finished_at: now(),
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
      })
      this.store.event(runID, 'step.routed', { step: path, route }, attemptID)
    })
    this.rememberCompletedUsage(attemptID, token)
    return this.advance(runID)
  }

  spawn(
    runID: number,
    path: string,
    token: string,
    input: {
      count: number
      prompt: string
      model?: string
      provider?: string
      policy?: StepPolicy
      limits?: Limits
    }
  ): { run: RunRow; children: RunRow[] } {
    const { run, row } = this.requireRunningStep(runID, path, token)
    if (input.count < 1 || input.count > 32) {
      throw new OrchestrationErrorWithCode('spawn_count', 'count must be between 1 and 32')
    }
    const parentNode = findNode(JSON.parse(run.snapshot) as CompiledNode, path)
    const children: RunRow[] = []
    for (let index = 0; index < input.count; index++) {
      const childPath = `spawn/${index + 1}`
      const node: CompiledNode = {
        path: childPath,
        kind: 'agent',
        name: `${parentNode?.name ?? 'worker'}-${index + 1}`,
        title: `${parentNode?.name ?? 'worker'} worker ${index + 1}`,
        prompt: input.prompt,
        enforcement: run.enforcement as CompiledNode['enforcement'],
        ...((input.model ?? parentNode?.model) ? { model: input.model ?? parentNode?.model } : {}),
        ...((input.provider ?? parentNode?.provider)
          ? { provider: input.provider ?? parentNode?.provider }
          : {}),
        ...(input.policy ? { policy: input.policy } : {}),
        ...(input.limits ? { limits: input.limits } : {}),
      }
      const snapshot = JSON.stringify(node)
      const hash = `sha256:${randomUUID()}`
      const child = this.store.insertRun({
        workspace: run.workspace,
        prompt: input.prompt,
        target: `${run.id}/${path}/spawn`,
        root_run_id: Number(run.root_run_id),
        parent_run_id: runID,
        parent_step_path: path,
        origin_session_id: run.origin_session_id,
        origin_harness: run.origin_harness,
        origin_agent: run.origin_agent,
        origin_kind: run.origin_kind,
        pipeline_ref: 'spawn',
        snapshot,
        hash,
        enforcement: run.enforcement,
        notification: run.notification,
      })
      this.store.event(Number(child.id), 'run.spawned', { parent_run_id: runID, step: path })
      this.advance(Number(child.id))
      children.push(this.store.run(Number(child.id)) as RunRow)
    }
    const attemptID = row.current_attempt_id
    const serialized = JSON.stringify({ spawned: children.map((child) => child.id) })
    this.store.transaction(() => {
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), {
          status: 'waiting_children',
          result: serialized,
        })
      }
      this.store.updateStep(Number(row.id), {
        status: 'waiting_children',
        result: serialized,
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: null,
      })
      this.store.event(
        runID,
        'step.spawned',
        {
          step: path,
          children: children.map((child) => child.id),
        },
        attemptID
      )
    })
    return { run: this.store.run(runID) as RunRow, children }
  }

  check(
    runID: number,
    path: string,
    check: PolicyCheck,
    usage?: Partial<Usage>,
    token?: string
  ): PolicyDecision {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    const row = this.store.step(runID, path)
    if (!row) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    const policy = parseJson<StepPolicy | undefined>(row.policy, undefined)
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    const current: Usage = {
      turns: usage?.turns ?? Number(row.turns),
      tokens: usage?.budgetTokens ?? usage?.tokens ?? Number(row.tokens),
      toolCalls: usage?.toolCalls ?? Number(row.tool_calls),
      elapsedSeconds: row.started_at ? ageMs(row.started_at) / 1000 : 0,
      violations: usage?.violations ?? Number(row.violations),
    }
    if (isTerminal(run)) {
      return {
        effect: 'deny',
        reason: `run is ${run.state}`,
        remaining: remainingBudget(budget, current),
        closed: true,
      }
    }
    if (token && row.status === 'running' && row.lease_id !== token) {
      return {
        effect: 'deny',
        reason: `work token does not own ${path}`,
        remaining: remainingBudget(budget, current),
        closed: true,
      }
    }
    if (row.status !== 'running') {
      return {
        effect: 'deny',
        reason: `step is ${row.status}`,
        remaining: remainingBudget(budget, current),
        closed: true,
      }
    }
    const decision = evaluatePolicy(policy, budget, current, check)
    if (decision.effect !== 'deny') return decision
    const exceeded = decision.budgetExhausted ?? budgetExceeded(budget, current)
    if (exceeded && !isControlTool(check.tool)) {
      // Budgets are resource caps, not permission rules. Enforce them in every
      // enforcement mode so an observed step cannot run unbounded, but keep the
      // session alive so the worker can still report a result or failure.
      const attemptID = row.current_attempt_id
      if (attemptID !== null) {
        const previous = this.store.stepAttempt(Number(run.id), path, Number(row.attempt))
        if (previous?.budget_exhausted !== 1) {
          this.store.updateStepAttempt(Number(attemptID), { budget_exhausted: 1 })
          this.store.event(
            runID,
            'budget.exhausted',
            {
              step: path,
              action: check.action,
              tool: check.tool,
              reason: exceeded,
            },
            attemptID
          )
        }
      }
      return {
        ...decision,
        effect: 'deny',
        reason: `budget exhausted: ${decision.reason ?? exceeded}; call clara_complete with your result or clara_fail with the handoff now`,
        closed: false,
      }
    }
    if (run.enforcement === 'observed') {
      this.store.event(
        runID,
        'policy.observed',
        {
          step: path,
          action: check.action,
          tool: check.tool,
          reason: decision.reason,
        },
        row.current_attempt_id
      )
      return { ...decision, effect: 'allow', reason: `observed: ${decision.reason}` }
    }
    const updated = this.recordViolation(run, row, decision.reason ?? 'policy denied')
    return {
      ...decision,
      violations: Number(updated.violations),
      closed: updated.status !== 'running',
    }
  }

  private recordViolation(run: RunRow, row: StepRow, reason: string): StepRow {
    const runID = Number(run.id)
    const attemptID = row.current_attempt_id
    const violations = Number(row.violations) + 1
    this.store.transaction(() => {
      this.store.updateStep(Number(row.id), { violations })
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), { violations })
      }
      this.store.event(runID, 'policy.denied', { step: row.path, reason }, attemptID)
    })
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    if (violations >= budget.maxViolations) {
      const attempt = Number(row.attempt)
      const maxAttempts = Number(row.max_attempts) + Number(row.recovery_cycles)
      if (attempt < maxAttempts) {
        this.store.transaction(() => {
          if (attemptID !== null) {
            this.store.updateStepAttempt(Number(attemptID), {
              status: 'retry',
              error: reason,
              finished_at: now(),
            })
          }
          this.store.updateStep(Number(row.id), {
            status: 'ready',
            error: reason,
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
            finished_at: null,
          })
          this.store.event(
            runID,
            'step.retry',
            { step: row.path, attempt, error: reason },
            attemptID
          )
        })
      } else {
        this.store.transaction(() => {
          if (attemptID !== null) {
            this.store.updateStepAttempt(Number(attemptID), {
              status: 'failed',
              error: `violation limit reached: ${reason}`,
              finished_at: now(),
            })
          }
          this.store.updateStep(Number(row.id), {
            status: 'failed',
            error: `violation limit reached: ${reason}`,
            finished_at: now(),
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          const alert = this.store.alert({
            run_id: runID,
            step_path: row.path,
            kind: 'failure',
            title: `Policy violations exhausted in ${row.name}`,
            body: reason,
          })
          this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'failure' }, attemptID)
        })
      }
      this.advance(runID)
    }
    return this.store.step(runID, row.path) as StepRow
  }

  violation(runID: number, path: string, reason: string): StepRow {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    const row = this.store.step(runID, path)
    if (!row) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    if (isTerminal(run) || row.status !== 'running') return row
    if (run.enforcement === 'observed') {
      this.store.event(runID, 'policy.observed', { step: path, reason }, row.current_attempt_id)
      return row
    }
    return this.recordViolation(run, row, reason)
  }

  private rememberCompletedUsage(attemptID: number | null, token: string): void {
    if (attemptID === null) return
    const at = Date.now()
    for (const [id, entry] of this.completedUsage) {
      if (entry.expires < at) this.completedUsage.delete(id)
    }
    this.completedUsage.set(attemptID, { token, expires: at + 5 * 60_000 })
  }

  private lateUsage(runID: number, row: StepRow, token: string, usage: Partial<Usage>): StepRow {
    const attemptID = row.current_attempt_id
    const remembered = attemptID === null ? undefined : this.completedUsage.get(attemptID)
    if (!remembered || remembered.token !== token || remembered.expires < Date.now()) {
      throw new OrchestrationErrorWithCode(
        'step_not_running',
        `step ${row.path} is ${row.status} and no longer accepts usage`
      )
    }
    const fields = {
      ...(usage.turns !== undefined ? { turns: Math.max(Number(row.turns), usage.turns) } : {}),
      ...(usage.tokens !== undefined ? { tokens: Math.max(Number(row.tokens), usage.tokens) } : {}),
      ...(usage.toolCalls !== undefined
        ? { tool_calls: Math.max(Number(row.tool_calls), usage.toolCalls) }
        : {}),
      ...(usage.violations !== undefined
        ? { violations: Math.max(Number(row.violations), usage.violations) }
        : {}),
    }
    if (!Object.keys(fields).length) return row
    this.store.transaction(() => {
      this.store.updateStep(Number(row.id), fields)
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), fields)
      }
    })
    return this.store.step(runID, row.path) as StepRow
  }

  usage(runID: number, path: string, token: string, usage: Partial<Usage>): StepRow {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    const known = this.store.step(runID, path)
    if (!known) {
      throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    }
    // A harness reports the last model turn after it records the result. Keep
    // accepting a higher total from the attempt that just owned the step, but
    // never let a stale attempt overwrite a live one.
    if (known.status !== 'running') return this.lateUsage(runID, known, token, usage)
    const { row } = this.requireRunningStep(runID, path, token)
    const attemptID = row.current_attempt_id
    const fields = {
      ...(usage.turns !== undefined ? { turns: usage.turns } : {}),
      ...(usage.tokens !== undefined ? { tokens: usage.tokens } : {}),
      ...(usage.toolCalls !== undefined ? { tool_calls: usage.toolCalls } : {}),
      ...(usage.violations !== undefined ? { violations: usage.violations } : {}),
    }
    this.store.transaction(() => {
      this.store.updateStep(Number(row.id), {
        ...fields,
        heartbeat_at: now(),
        lease_expires_at: new Date(Date.now() + this.leaseMs).toISOString(),
      })
      if (attemptID !== null) {
        this.store.updateStepAttempt(Number(attemptID), fields)
      }
    })
    return this.store.step(runID, path) as StepRow
  }

  heartbeat(runID: number, path: string, token: string): StepRow {
    const { row } = this.requireRunningStep(runID, path, token)
    this.store.updateStep(Number(row.id), {
      heartbeat_at: now(),
      lease_expires_at: new Date(Date.now() + this.leaseMs).toISOString(),
    })
    return this.store.step(runID, path) as StepRow
  }

  /** Record a bounded chunk of script output on the attempt's event stream. */
  output(
    runID: number,
    path: string,
    token: string,
    stream: 'stdout' | 'stderr',
    chunk: string
  ): void {
    const { row } = this.requireRunningStep(runID, path, token)
    if (!chunk) return
    this.store.event(runID, 'step.output', { step: path, stream, chunk }, row.current_attempt_id)
  }

  status(runID: number): StatusResult {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    this.advance(runID)
    return {
      run: this.store.run(runID) as RunRow,
      steps: this.store.steps(runID),
      alerts: this.store.openAlerts(runID),
      children: this.store.db
        .prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY id')
        .all(runID) as RunRow[],
    }
  }

  cancel(runID: number, reason: string): RunRow {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (run.state === 'completed') {
      throw new OrchestrationErrorWithCode('run_completed', 'a completed run cannot be cancelled')
    }
    if (run.state !== 'cancelled') {
      this.store.transaction(() => {
        this.store.updateRun(runID, { state: 'cancelled', finished_at: now(), error: reason })
        this.store.event(runID, 'run.cancelled', { reason })
        this.settleRun(runID, 'parent_cancelled')
      })
    }
    return this.store.run(runID) as RunRow
  }

  /** Alert once when a ready script step has no capable runner for its workspace. */
  private checkRunner(run: RunRow, alerts: AlertRow[]): void {
    const runID = Number(run.id)
    const waiting = this.store
      .steps(runID)
      .filter((step) => step.type === 'script' && step.status === 'ready')
    if (!waiting.length) return
    const root = JSON.parse(run.snapshot) as CompiledNode
    const existing = new Set(
      this.store
        .openAlerts(runID)
        .filter((alert) => alert.kind === 'no_runner')
        .map((alert) => alert.step_path)
    )
    for (const step of waiting) {
      if (existing.has(step.path)) continue
      if (ageMs(step.updated_at) < this.runnerWaitMs) continue
      const node = findNode(root, step.path)
      if (this.hasRunner(resolve(run.workspace), node?.requires?.runner)) continue
      const alert = this.store.alert({
        run_id: runID,
        step_path: step.path,
        kind: 'no_runner',
        title: `No runner for script step: ${step.name}`,
        body: node?.requires?.runner
          ? `No live runner labelled "${node.requires.runner}" with the script capability is registered for this workspace.`
          : 'No live runner with the script capability is registered for this workspace.',
      })
      this.store.event(
        runID,
        'alert.created',
        { alert: alert.id, kind: 'no_runner' },
        step.current_attempt_id
      )
      alerts.push(alert)
    }
  }

  private hasRunner(workspace: string, required?: string): boolean {
    return this.store.adapters(workspace).some((row) => {
      if (row.role !== 'runner') return false
      if (ageMs(row.heartbeat_at) > this.adapterStaleMs) return false
      if (!parseJson<string[]>(row.capabilities, []).includes('script')) return false
      if (!required) return true
      const labels = parseJson<string[]>(row.labels, [])
      return row.id === required || labels.includes(required)
    })
  }

  tick(): { alerts: AlertRow[] } {
    const alerts: AlertRow[] = []
    for (const run of this.store.activeRuns()) {
      const runID = Number(run.id)
      this.advance(runID)
      this.checkRunner(run, alerts)
      for (const snapshot of this.store.steps(runID)) {
        // Re-read the row: failing one step settles every other live step, so
        // the snapshot taken at loop entry is stale after the first failure.
        const step = this.store.step(runID, snapshot.path)
        if (!step || step.status !== 'running') continue
        if (step.type !== 'agent' && step.type !== 'router' && step.type !== 'script') continue
        const stalled = ageMs(step.heartbeat_at) > this.stalledMs
        const expired = step.lease_expires_at ? ageMs(step.lease_expires_at) >= 0 : false
        if (!stalled && !expired) continue
        const reason = expired ? 'lease expired' : 'heartbeat stalled'
        const attemptID = step.current_attempt_id
        const body = expired
          ? 'The worker lease expired.'
          : 'The worker stopped reporting heartbeats.'
        if (Number(step.attempt) < Number(step.max_attempts)) {
          this.store.transaction(() => {
            if (attemptID !== null) {
              this.store.updateStepAttempt(Number(attemptID), {
                status: 'retry',
                error: reason,
                finished_at: now(),
              })
            }
            this.store.updateStep(Number(step.id), {
              status: 'ready',
              error: reason,
              lease_id: null,
              lease_owner: null,
              lease_expires_at: null,
            })
            const alert = this.store.alert({
              run_id: runID,
              step_path: step.path,
              kind: 'stalled',
              title: `Stalled step: ${step.name}`,
              body,
            })
            this.store.event(
              runID,
              'watchdog.retry',
              { step: step.path, alert: alert.id, reason },
              attemptID
            )
            alerts.push(alert)
          })
          this.advance(runID)
          continue
        }
        this.store.transaction(() => {
          if (attemptID !== null) {
            this.store.updateStepAttempt(Number(attemptID), {
              status: 'failed',
              error: reason,
              finished_at: now(),
            })
          }
          this.store.updateStep(Number(step.id), {
            status: 'failed',
            error: reason,
            finished_at: now(),
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          const alert = this.store.alert({
            run_id: runID,
            step_path: step.path,
            kind: 'stalled',
            title: `Step exhausted retries: ${step.name}`,
            body,
          })
          this.store.event(
            runID,
            'step.failed',
            { step: step.path, attempt: Number(step.attempt), error: reason },
            attemptID
          )
          this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'stalled' }, attemptID)
          alerts.push(alert)
        })
        // The run state is not written here: advance() owns the transition and
        // settles every other live step in the same pass.
        this.advance(runID)
        break
      }
    }
    return { alerts }
  }

  inbox(): AlertRow[] {
    return this.store.openAlerts()
  }

  ack(alertID: number): void {
    this.store.resolveAlert(alertID)
  }

  /**
   * Reserve a terminal root run and/or its alerts for delivery. The adapter
   * calls this before it queues a wake, so several plugin instances sharing one
   * orchestrator cannot all deliver the same terminal transition. A terminal
   * claim is only granted for a finished root run; child runs roll up.
   */
  claimDelivery(
    runID: number,
    input: { session_id?: string | null; terminal?: boolean; alert_ids?: number[] }
  ): DeliveryClaimResult {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (input.terminal && (run.parent_run_id != null || !isTerminal(run))) {
      return { terminal: false, alerts: [] }
    }
    return this.store.claimDelivery({
      run_id: runID,
      session_id: input.session_id ?? null,
      terminal: input.terminal === true,
      alert_ids: input.alert_ids ?? [],
    })
  }

  /** Release a claim whose prompt failed so another delivery cycle can retry. */
  releaseDelivery(runID: number, input: { terminal?: boolean; alert_ids?: number[] }): void {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    this.store.releaseDelivery({
      run_id: runID,
      terminal: input.terminal === true,
      alert_ids: input.alert_ids ?? [],
    })
  }

  list(): RunRow[] {
    return this.store.runs()
  }

  /** Read-only analysis of run history, failures, alerts, and setup signals. */
  diagnostics(options: DiagnosticsOptions = {}): DiagnosticsReport {
    return analyzeDatabase(this.store.db, options)
  }

  /** The pinned compiled tree for a run. Only the Lab reads this. */
  pinned(runID: number): { run_id: number; hash: string; snapshot: string } {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    return { run_id: Number(run.id), hash: run.hash, snapshot: run.snapshot }
  }

  /** The full step row, including its rendered prompt and lease metadata. */
  stepDetail(runID: number, path: string): StepRow {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    const step = this.store.step(runID, path)
    if (!step) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    const node = findNode(JSON.parse(run.snapshot) as CompiledNode, path)
    return node?.script ? { ...step, script: node.script } : step
  }

  /** Attempt history for a run, optionally narrowed to one step. */
  attempts(runID: number, path?: string): StepAttemptRow[] {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (path !== undefined && !this.store.step(runID, path)) {
      throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    }
    return this.store.stepAttempts(runID, path)
  }

  registerAdapter(input: {
    harness: string
    role?: 'harness' | 'runner'
    machine?: string | null
    labels?: string[]
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }) {
    return this.store.upsertAdapter({
      id: input.id ?? randomUUID(),
      harness: input.harness,
      role: input.role ?? 'harness',
      machine: input.machine ?? null,
      labels: input.labels ?? [],
      session_id: input.session_id ?? null,
      workspace: resolve(input.workspace),
      capabilities: input.capabilities,
    })
  }

  heartbeatAdapter(id: string): void {
    this.store.heartbeatAdapter(id)
  }

  removeAdapter(id: string): void {
    this.store.removeAdapter(id)
  }

  adapters(workspace?: string) {
    return this.store.adapters(workspace ? resolve(workspace) : undefined)
  }
}

export function findNode(root: CompiledNode, path: string): CompiledNode | undefined {
  if (root.path === path) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, path)
    if (found) return found
  }
  for (const child of root.onFailure?.children ?? []) {
    const found = findNode(child, path)
    if (found) return found
  }
  for (const route of root.routes ?? []) {
    if (!route.target) continue
    const found = findNode(route.target, path)
    if (found) return found
  }
  return undefined
}

export function isTerminal(run: RunRow): boolean {
  return run.state === 'completed' || run.state === 'cancelled' || run.state === 'failed'
}

export function completedSteps(steps: StepRow[]): StepRow[] {
  return steps.filter((step) => DONE.has(step.status))
}

export function defaultUsage(): Usage {
  return emptyUsage()
}
