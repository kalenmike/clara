import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  budgetExceeded,
  computeBudget,
  emptyUsage,
  evaluatePolicy,
  remainingBudget,
  type EffectiveBudget,
  type Limits,
  type PolicyCheck,
  type PolicyDecision,
  type StepPolicy,
  type Usage,
} from '@clara/policy'
import { compileRun, loadCatalog } from './loader.ts'
import type { CompiledNode, LoadedCatalog } from './types.ts'
import { now, type AlertRow, type RunRow, type StepRow, Store } from './store.ts'

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
  prompt: string
  workspace: string
  work_token: string
  attempt: number
  max_attempts: number
  model?: string
  policy?: StepPolicy
  limits?: Limits
  budget: EffectiveBudget
  enforcement: string
  background: boolean
  routes?: Array<{ when: string; run: string; criteria?: string; description?: string }>
  context: {
    prompt: string
    steps: Array<{ path: string; name: string; result: unknown }>
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
}

interface NodeSync {
  status: 'ready' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed'
}

const DONE = new Set(['done', 'skipped'])

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
  private catalogCache = new Map<string, { at: number; catalog: LoadedCatalog }>()

  constructor(options: RuntimeOptions) {
    this.store = options.store
    this.configPath = options.configPath
    this.stdDir = options.stdDir
    this.leaseMs = options.leaseMs ?? 30 * 60_000
    this.stalledMs = options.stalledMs ?? 30_000
    this.adapterStaleMs = options.adapterStaleMs ?? 120_000
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
    if (enforcement === 'strict') this.assertAdapter(workspace, compiled.root.requires)
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
    const work = this.claim(Number(run.id), 8)
    return { run: this.store.run(Number(run.id)) as RunRow, work }
  }

  private assertAdapter(workspace: string, requires: CompiledNode['requires']): void {
    const capabilities = requires?.capabilities ?? ['tool_policy', 'turn_limit', 'token_limit']
    const adapter = this.store.adapters(workspace).find(
      (row) =>
        ageMs(row.heartbeat_at) <= this.adapterStaleMs &&
        capabilities.every((capability) => {
          const parsed = parseJson<string[]>(row.capabilities, [])
          return parsed.includes(capability)
        })
    )
    if (!adapter) {
      throw new OrchestrationErrorWithCode(
        'enforcement_unavailable',
        `This pipeline requires strict enforcement; no live ${requires?.adapter ?? 'harness'} adapter with ${capabilities.join(', ')} is registered for ${workspace}.`
      )
    }
  }

  advance(runID: number): AdvanceResult {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    if (run.state === 'completed' || run.state === 'cancelled' || run.state === 'failed') {
      return { run, ready: [] }
    }
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

    const readyStep = (row: StepRow, node: CompiledNode): NodeSync => {
      if (row.status === 'pending') {
        const updated = mark(row, { status: 'ready' })
        this.store.event(runID, 'step.ready', {
          step: node.path,
          name: node.name,
          kind: node.kind,
          background: Boolean(node.background),
        })
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

    const sync = (node: CompiledNode, parentPath: string | null): NodeSync => {
      const row = ensure(node, parentPath)

      if (node.kind === 'task') {
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
            mark(row, {
              status: 'failed',
              error: `child run ${failed.id} failed`,
              finished_at: now(),
              lease_id: null,
              lease_owner: null,
              lease_expires_at: null,
            })
            this.store.event(runID, 'step.failed', {
              step: node.path,
              run: failed.id,
              reason: 'fail_fast',
            })
            return { status: 'failed' }
          }
          if (children.every((child) => child.state === 'completed')) {
            const results = children.map((child) => ({
              run_id: child.id,
              result: parseJson<unknown>(this.latestResult(Number(child.id)), null),
            }))
            mark(row, {
              status: 'done',
              result: JSON.stringify({ spawned: results }),
              finished_at: now(),
            })
            this.store.event(runID, 'step.completed', {
              step: node.path,
              spawned: children.map((c) => c.id),
            })
            return { status: 'done' }
          }
          return { status: 'waiting' }
        }
        return readyStep(row, node)
      }

      if (node.kind === 'router') {
        if (row.status === 'done') {
          const result = parseJson<{ route?: string }>(row.result, {})
          if (!result.route) return { status: 'failed' }
          const route = node.routes?.find((candidate) => candidate.when === result.route)
          if (!route?.target) {
            return { status: 'failed' }
          }
          const target = sync(route.target, node.path)
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
        return readyStep(row, node)
      }

      // pipeline / group
      if (row.status === 'failed') return { status: 'failed' }
      if (row.status === 'done' || row.status === 'skipped') return { status: 'done' }
      const children = node.children ?? []
      if (!children.length) {
        mark(row, { status: 'done', finished_at: now() })
        return { status: 'done' }
      }
      const background = children.filter((child) => child.background)
      const foreground = children.filter((child) => !child.background)

      if (background.length) {
        for (const child of background) {
          const result = sync(child, node.path)
          if (result.status === 'failed') {
            mark(row, { status: 'failed', error: `${child.name} failed`, finished_at: now() })
            return { status: 'failed' }
          }
          if (result.status !== 'done') {
            mark(row, { status: 'running' })
            return { status: 'running' }
          }
        }
      }

      for (const child of foreground) {
        const result = sync(child, node.path)
        if (result.status === 'failed') {
          mark(row, { status: 'failed', error: `${child.name} failed`, finished_at: now() })
          return { status: 'failed' }
        }
        if (result.status !== 'done') {
          mark(row, { status: 'running' })
          return { status: 'running' }
        }
      }

      mark(row, { status: 'done', finished_at: now() })
      return { status: 'done' }
    }

    const result = sync(root, null)
    const latest = this.store.run(runID) as RunRow
    if (result.status === 'failed' && latest.state !== 'completed') {
      this.store.updateRun(runID, {
        state: 'failed',
        finished_at: now(),
        error: latest.error ?? 'pipeline failed',
      })
      this.store.event(runID, 'run.failed', {})
    } else if (result.status === 'done' && latest.state !== 'completed') {
      this.store.updateRun(runID, { state: 'completed', finished_at: now() })
      this.store.event(runID, 'run.completed', {})
    } else if (latest.state !== 'completed' && latest.state !== 'cancelled') {
      const state = ready.length ? 'running' : 'waiting'
      if (latest.state !== state) this.store.updateRun(runID, { state })
    }
    return { run: this.store.run(runID) as RunRow, ready }
  }

  private latestResult(runID: number): string | null {
    const steps = this.store.steps(runID)
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index].result) return steps[index].result
    }
    return null
  }

  claim(runID: number, limit = 1, owner = 'dispatcher'): WorkOrder[] {
    const advanced = this.advance(runID)
    const run = advanced.run
    const root = JSON.parse(run.snapshot) as CompiledNode
    const orders: WorkOrder[] = []
    for (const row of advanced.ready) {
      if (orders.length >= limit) break
      if (row.status !== 'ready') continue
      if (row.lease_id && ageMs(row.lease_expires_at) < this.leaseMs) continue
      const node = findNode(root, row.path)
      if (!node) continue
      const token = randomUUID()
      const expires = new Date(Date.now() + this.leaseMs).toISOString()
      const attempt = Number(row.attempt) + 1
      this.store.updateStep(Number(row.id), {
        status: 'running',
        attempt,
        // A new attempt gets a fresh budget. Carrying usage over would make a
        // retry start already exhausted.
        turns: 0,
        tokens: 0,
        tool_calls: 0,
        violations: 0,
        lease_id: token,
        lease_owner: owner,
        lease_expires_at: expires,
        heartbeat_at: now(),
        started_at: row.started_at ?? now(),
      })
      this.store.event(runID, 'step.started', { step: row.path, attempt, owner })
      const updated = this.store.step(runID, row.path) as StepRow
      orders.push(this.workOrder(run, updated, node, token))
    }
    if (orders.length) {
      this.store.updateRun(runID, { state: 'running' })
    }
    return orders
  }

  private workOrder(run: RunRow, row: StepRow, node: CompiledNode, token: string): WorkOrder {
    const policy = parseJson<StepPolicy | undefined>(row.policy, undefined)
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    const completed = this.store
      .steps(Number(run.id))
      .filter((step) => step.result && ['task', 'router', 'pipeline', 'group'].includes(step.type))
      .slice(-20)
      .map((step) => ({
        path: step.path,
        name: step.name,
        result: parseJson<unknown>(step.result, null),
      }))
    return {
      run_id: Number(run.id),
      step_path: node.path,
      name: node.name,
      kind: node.kind,
      prompt: node.prompt ?? node.description ?? `Execute ${node.name}`,
      workspace: run.workspace,
      work_token: token,
      attempt: Number(row.attempt),
      max_attempts: Number(row.max_attempts),
      ...(node.model ? { model: node.model } : {}),
      ...(policy ? { policy } : {}),
      ...(limits ? { limits } : {}),
      budget,
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
      context: {
        prompt: run.prompt,
        steps: completed,
      },
    }
  }

  next(runID: number, limit = 1, owner = 'mcp'): WorkOrder[] {
    return this.claim(runID, limit, owner)
  }

  private requireRunningStep(
    runID: number,
    path: string,
    token: string
  ): { run: RunRow; row: StepRow } {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
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
    usage?: Partial<Usage>
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
    const retry = Boolean(exceeded && Number(row.attempt) < Number(row.max_attempts))
    this.store.updateStep(Number(row.id), {
      status: retry ? 'ready' : exceeded ? 'failed' : 'done',
      result: JSON.stringify(result),
      turns,
      tokens,
      tool_calls: toolCalls,
      violations,
      finished_at: retry ? null : now(),
      error: exceeded ?? null,
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    this.store.event(runID, retry ? 'step.retry' : exceeded ? 'step.failed' : 'step.completed', {
      step: path,
      ...(exceeded ? { reason: exceeded } : {}),
    })
    if (exceeded && !retry) {
      const alert = this.store.alert({
        run_id: runID,
        step_path: path,
        kind: 'budget',
        title: `Budget exhausted in ${path}`,
        body: exceeded,
      })
      this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'budget' })
    }
    return this.advance(runID)
  }

  fail(
    runID: number,
    path: string,
    token: string,
    error: string,
    usage?: Partial<Usage>
  ): { run: RunRow; retry: boolean; ready: StepRow[] } {
    const { row } = this.requireRunningStep(runID, path, token)
    const attempt = Number(row.attempt)
    const maxAttempts = Number(row.max_attempts)
    const fields = {
      turns: usage?.turns ?? Number(row.turns),
      tokens: usage?.tokens ?? Number(row.tokens),
      tool_calls: usage?.toolCalls ?? Number(row.tool_calls),
      violations: usage?.violations ?? Number(row.violations),
    }
    if (attempt < maxAttempts) {
      this.store.updateStep(Number(row.id), {
        ...fields,
        status: 'ready',
        error,
        lease_id: null,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: null,
      })
      this.store.event(runID, 'step.retry', { step: path, attempt, error })
      const advanced = this.advance(runID)
      return { run: advanced.run, retry: true, ready: advanced.ready }
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
    this.store.event(runID, 'step.failed', { step: path, attempt, error })
    const alert = this.store.alert({
      run_id: runID,
      step_path: path,
      kind: 'failure',
      title: `Step failed: ${row.name}`,
      body: error,
    })
    this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'failure' })
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
    this.store.updateStep(Number(row.id), {
      status: 'done',
      result: JSON.stringify({ route }),
      finished_at: now(),
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    this.store.event(runID, 'step.routed', { step: path, route })
    return this.advance(runID)
  }

  spawn(
    runID: number,
    path: string,
    token: string,
    input: { count: number; prompt: string; model?: string; policy?: StepPolicy; limits?: Limits }
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
        kind: 'task',
        name: `${parentNode?.name ?? 'worker'}-${index + 1}`,
        title: `${parentNode?.name ?? 'worker'} worker ${index + 1}`,
        prompt: input.prompt,
        enforcement: run.enforcement as CompiledNode['enforcement'],
        ...(input.model ? { model: input.model } : {}),
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
    this.store.updateStep(Number(row.id), {
      status: 'waiting_children',
      result: JSON.stringify({ spawned: children.map((child) => child.id) }),
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
      finished_at: null,
    })
    this.store.event(runID, 'step.spawned', {
      step: path,
      children: children.map((child) => child.id),
    })
    return { run: this.store.run(runID) as RunRow, children }
  }

  check(runID: number, path: string, check: PolicyCheck, usage?: Partial<Usage>): PolicyDecision {
    const run = this.store.run(runID)
    if (!run) throw new OrchestrationErrorWithCode('run_missing', `run ${runID} does not exist`)
    const row = this.store.step(runID, path)
    if (!row) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    const policy = parseJson<StepPolicy | undefined>(row.policy, undefined)
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    const current: Usage = {
      turns: usage?.turns ?? Number(row.turns),
      tokens: usage?.tokens ?? Number(row.tokens),
      toolCalls: usage?.toolCalls ?? Number(row.tool_calls),
      elapsedSeconds: row.started_at ? ageMs(row.started_at) / 1000 : 0,
      violations: usage?.violations ?? Number(row.violations),
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
    if (run.enforcement === 'observed') {
      this.store.event(runID, 'policy.observed', {
        step: path,
        action: check.action,
        tool: check.tool,
        reason: decision.reason,
      })
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
    const violations = Number(row.violations) + 1
    this.store.updateStep(Number(row.id), { violations })
    this.store.event(runID, 'policy.denied', { step: row.path, reason })
    const limits = parseJson<Limits | undefined>(row.limits, undefined)
    const budget = computeBudget(limits, Number(row.attempt) || 1)
    if (violations >= budget.maxViolations) {
      const attempt = Number(row.attempt)
      const maxAttempts = Number(row.max_attempts)
      if (attempt < maxAttempts) {
        this.store.updateStep(Number(row.id), {
          status: 'ready',
          error: reason,
          lease_id: null,
          lease_owner: null,
          lease_expires_at: null,
          finished_at: null,
        })
        this.store.event(runID, 'step.retry', { step: row.path, attempt, error: reason })
      } else {
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
        this.store.event(runID, 'alert.created', { alert: alert.id, kind: 'failure' })
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
    if (row.status !== 'running') return row
    if (run.enforcement === 'observed') {
      this.store.event(runID, 'policy.observed', { step: path, reason })
      return row
    }
    return this.recordViolation(run, row, reason)
  }

  usage(runID: number, path: string, usage: Partial<Usage>): StepRow {
    const row = this.store.step(runID, path)
    if (!row) throw new OrchestrationErrorWithCode('step_missing', `step ${path} does not exist`)
    this.store.updateStep(Number(row.id), {
      ...(usage.turns !== undefined ? { turns: usage.turns } : {}),
      ...(usage.tokens !== undefined ? { tokens: usage.tokens } : {}),
      ...(usage.toolCalls !== undefined ? { tool_calls: usage.toolCalls } : {}),
      ...(usage.violations !== undefined ? { violations: usage.violations } : {}),
      heartbeat_at: now(),
      lease_expires_at: new Date(Date.now() + this.leaseMs).toISOString(),
    })
    return this.store.step(runID, path) as StepRow
  }

  heartbeat(runID: number, path: string): void {
    const row = this.store.step(runID, path)
    if (!row) return
    this.store.updateStep(Number(row.id), {
      heartbeat_at: now(),
      lease_expires_at: new Date(Date.now() + this.leaseMs).toISOString(),
    })
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
      this.store.updateRun(runID, { state: 'cancelled', finished_at: now(), error: reason })
      for (const step of this.store.steps(runID)) {
        if (step.status === 'running' || step.status === 'ready') {
          this.store.updateStep(Number(step.id), {
            status: 'cancelled',
            finished_at: now(),
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
        }
      }
      this.store.event(runID, 'run.cancelled', { reason })
      for (const child of this.store.db
        .prepare('SELECT * FROM runs WHERE parent_run_id = ?')
        .all(runID) as RunRow[]) {
        if (child.state !== 'completed' && child.state !== 'cancelled') {
          this.cancel(Number(child.id), 'parent_cancelled')
        }
      }
    }
    return this.store.run(runID) as RunRow
  }

  tick(): { alerts: AlertRow[] } {
    const alerts: AlertRow[] = []
    for (const run of this.store.activeRuns()) {
      this.advance(Number(run.id))
      for (const step of this.store.steps(Number(run.id))) {
        if (step.status !== 'running') continue
        if (step.type !== 'task' && step.type !== 'router') continue
        const stalled = ageMs(step.heartbeat_at) > this.stalledMs
        const expired = step.lease_expires_at ? ageMs(step.lease_expires_at) >= 0 : false
        if (!stalled && !expired) continue
        if (Number(step.attempt) < Number(step.max_attempts)) {
          this.store.updateStep(Number(step.id), {
            status: 'ready',
            error: expired ? 'lease expired' : 'heartbeat stalled',
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          const alert = this.store.alert({
            run_id: Number(run.id),
            step_path: step.path,
            kind: 'stalled',
            title: `Stalled step: ${step.name}`,
            body: expired
              ? 'The worker lease expired.'
              : 'The worker stopped reporting heartbeats.',
          })
          this.store.event(Number(run.id), 'watchdog.retry', { step: step.path, alert: alert.id })
          alerts.push(alert)
        } else {
          this.store.updateStep(Number(step.id), {
            status: 'failed',
            error: expired ? 'lease expired' : 'heartbeat stalled',
            finished_at: now(),
            lease_id: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          const alert = this.store.alert({
            run_id: Number(run.id),
            step_path: step.path,
            kind: 'stalled',
            title: `Step exhausted retries: ${step.name}`,
            body: expired
              ? 'The worker lease expired.'
              : 'The worker stopped reporting heartbeats.',
          })
          this.store.updateRun(Number(run.id), {
            state: 'failed',
            finished_at: now(),
            error: alert.body,
          })
          this.store.event(Number(run.id), 'run.failed', { step: step.path, alert: alert.id })
          alerts.push(alert)
        }
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

  list(): RunRow[] {
    return this.store.runs()
  }

  registerAdapter(input: {
    harness: string
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }) {
    return this.store.upsertAdapter({
      id: input.id ?? randomUUID(),
      harness: input.harness,
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
