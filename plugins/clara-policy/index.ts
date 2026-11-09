// Clara strict enforcement adapter for OpenCode.
//
// This plugin is both a tool surface and a policy enforcement point. It talks
// to the local Clara orchestrator over loopback HTTP, registers itself as an
// adapter, dispatches pipeline work into managed child sessions, and checks
// every tool call against the current step policy.
//
// Install it next to the MCP bridge when a workspace uses `enforcement: strict`.
// The MCP bridge remains the generic surface for other harnesses.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryCycle } from './delivery-cycle.ts'
import { isTerminalState } from './delivery.ts'
import type { DeliveryAlert, DeliveryRun, DeliveryState } from './delivery.ts'
import { NAMESPACE, renderWorkPrompt, scopeWorkerTools } from './prompt.ts'
import { tokenDelta, tokensFromEvent, tokenTotal } from './usage.ts'
import type { ModelTokens } from './usage.ts'
import { catalogPath, needsExplicitWorkspace, resolveWorkspace } from './workspace.ts'

const CAPABILITIES = ['tool_policy', 'path_policy', 'shell_policy', 'turn_limit', 'token_limit']
const INTERFACE_AGENT = process.env.CLARA_INTERFACE_AGENT?.trim() || 'clara'
const DELIVERY_LIMIT = 500

type Any = any

interface ServiceConfig {
  url: string
  token: string
}

interface ActiveWork {
  run_id: number
  step_path: string
  work_token: string
  name: string
  session: string
  workspace: string
  enforcement: string
  kind: string
  routes: Array<{ when: string }>
  managed: boolean
  model?: string
  provider?: string
  turns: number
  toolCalls: number
  tokens: number
  tokenMessages: Map<string, number>
  lastUsagePersist?: number
  closed: boolean
  watching: boolean
  corrected?: boolean
  lastText?: string
  beatTimer?: NodeJS.Timeout
}

const STEP_HEARTBEAT_MS = 10_000
const MISSING_CONTROL_PROMPT =
  'Your answer was not recorded. Call `clara_complete` with the result now, or `clara_fail` with the reason you could not finish. Do not reply with prose only.'

export function planMissingControl(input: {
  kind: string
  corrected?: boolean
  lastText?: string
  closed?: boolean
}): 'ignore' | 'correct' | 'complete' | 'fail' {
  // A control call settles the binding before the model finishes its turn. The
  // idle watcher must never treat that turn as a missing control call.
  if (input.closed) return 'ignore'
  if (input.kind === 'router') return 'fail'
  if (!input.corrected) return 'correct'
  if (input.lastText?.trim()) return 'complete'
  return 'fail'
}

export interface SettleBinding {
  session: string
  managed: boolean
  closed: boolean
  beatTimer?: NodeJS.Timeout
}

// A control call ends the step before the model finishes its turn. Mark the
// binding closed so the idle watcher cannot mistake the finished step for a
// missing control call. A managed worker keeps its closed binding until the
// session idles, so the rest of the turn stays under policy; a fallback binding
// of the human's session detaches at once and is never interrupted.
export function settleBinding<T extends SettleBinding>(
  active: Map<string, T>,
  lastTurn: Map<string, number>,
  session: string | undefined,
  detach = false
): T | undefined {
  if (!session) return undefined
  const work = active.get(session)
  if (!work) return undefined
  work.closed = true
  if (work.beatTimer) {
    clearInterval(work.beatTimer)
    work.beatTimer = undefined
  }
  if (detach || !work.managed) {
    active.delete(session)
    lastTurn.delete(session)
  }
  return work
}

// The step lease is a harness signal, not a model one. A slow turn or a long
// tool call produces no adapter events, so renew on a timer instead of waiting
// for the next context or tool hook.
export function startStepHeartbeat(
  beat: () => Promise<unknown>,
  options: { intervalMs?: number; onLost?: (error: Error) => void } = {}
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

function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

function serviceConfig(): ServiceConfig {
  const url = (process.env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789').replace(
    /\/$/,
    ''
  )
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return { url, token: configured }
  const path =
    process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(dataDir(), 'orchestrator.token')
  const token = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  return { url, token }
}

function deliveryFile(): string {
  return join(dataDir(), 'policy-delivery.json')
}

function readDeliveryState(): DeliveryState {
  const path = deliveryFile()
  if (!existsSync(path)) return { alerts: new Set(), runs: new Set() }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { alerts?: unknown; runs?: unknown }
    const ids = (value: unknown): Set<number> =>
      new Set(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [])
    return { alerts: ids(parsed.alerts), runs: ids(parsed.runs) }
  } catch {
    return { alerts: new Set(), runs: new Set() }
  }
}

function writeDeliveryState(state: DeliveryState): void {
  try {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
    writeFileSync(
      deliveryFile(),
      `${JSON.stringify({
        alerts: [...state.alerts].slice(-DELIVERY_LIMIT),
        runs: [...state.runs].slice(-DELIVERY_LIMIT),
      })}\n`,
      { mode: 0o600 }
    )
  } catch {
    // Delivery state is best effort. A lost file re-sends one open alert.
  }
}

async function call<T = unknown>(
  config: ServiceConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = undefined
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!response.ok) {
    const error = parsed as { error?: { code?: string; message?: string } } | undefined
    const failure = new Error(
      error?.error?.message ?? `Clara orchestrator returned ${response.status}`
    ) as Error & { code?: string }
    if (error?.error?.code) failure.code = error.error.code
    throw failure
  }
  return parsed as T
}

export const CONTROL_TOOL_OPTIONS = { namespace: NAMESPACE, codemode: false }

// The interface agent submits work; it never chooses the workspace or a
// pipeline. The orchestrator starts its configured entry point.
export const START_TOOL_INPUT = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
  },
  required: ['prompt'],
  additionalProperties: false,
}

function tool(
  name: string,
  description: string,
  input: Record<string, unknown>,
  execute: (input: Any, context: Any) => Promise<{ content: string }>
) {
  return { name, description, input, execute, options: CONTROL_TOOL_OPTIONS }
}

function sessionID(context: Any): string | undefined {
  return typeof context?.sessionID === 'string' ? context.sessionID : undefined
}

function content(value: unknown): { content: string } {
  return { content: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
}

function modelRef(work: Any): { providerID: string; id: string } | undefined {
  const provider = typeof work?.provider === 'string' ? work.provider.trim() : ''
  const model = typeof work?.model === 'string' ? work.model.trim() : ''
  if (!provider || !model) return undefined
  return { providerID: provider, id: model }
}

// Control tools belong to the managed session, so the adapter supplies the
// lease identifiers instead of asking the model for them.
function boundWork(active: Map<string, ActiveWork>, context: Any): ActiveWork {
  const id = sessionID(context)
  const work = id ? active.get(id) : undefined
  if (!work) throw new Error('Clara: this tool needs an active managed work order')
  if (work.closed) throw new Error('Clara policy: the step is no longer running')
  return work
}

export default {
  id: 'clara-policy',

  async setup(ctx: Any) {
    const config = serviceConfig()
    const active = new Map<string, ActiveWork>()
    const seenMessages = new Set<string>()
    const activeRuns = new Set<number>()
    const hadDeliveryState = existsSync(deliveryFile())
    const delivery = readDeliveryState()
    let adapterID: string | undefined
    let configuredWorkspace: string | undefined
    let serviceNeedsWorkspace = false
    const currentWorkspace = (): string => configuredWorkspace ?? resolveWorkspace(ctx)
    const lastTurn = new Map<string, number>()

    const terminal = (state: string): boolean =>
      state === 'completed' || state === 'failed' || state === 'cancelled'

    const pruneRun = (run: { id?: number; state?: string } | undefined): void => {
      if (run?.id !== undefined && run.state && terminal(run.state)) activeRuns.delete(run.id)
    }

    const stop = async (session: string): Promise<void> => {
      const sessions = ctx.session as Any
      try {
        if (typeof sessions?.interrupt === 'function') {
          await sessions.interrupt({ sessionID: session, resume: false })
        } else if (typeof sessions?.abort === 'function') {
          await sessions.abort({ sessionID: session })
        } else if (typeof sessions?.cancel === 'function') {
          await sessions.cancel({ sessionID: session })
        }
      } catch {
        // The session may already be finished.
      }
    }

    const finish = (session: string | undefined, detach = false): void => {
      // Without an idle watcher there is no way to release a closed binding
      // later, so detach it now. A managed worker otherwise keeps the closed
      // binding until watchControl sees the session go idle.
      const canWatch = typeof (ctx.session as Any)?.wait === 'function'
      settleBinding(active, lastTurn, session, detach || !canWatch)
    }

    const persist = async (work: ActiveWork): Promise<void> => {
      await call(
        config,
        'POST',
        `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/usage`,
        {
          work_token: work.work_token,
          usage: {
            turns: work.turns,
            toolCalls: work.toolCalls,
            tokens: work.tokens,
          },
        }
      ).catch(() => {})
    }

    // OpenCode can update one assistant message many times while it streams.
    // Apply only the new usage, and coalesce intermediate writes so a long turn
    // does not hammer the loopback service. Completion and failure always send
    // the full total.
    const applyTokens = (
      work: ActiveWork,
      messageID: string,
      usage: ModelTokens | undefined,
      final = false
    ): boolean => {
      const delta = tokenDelta(work.tokenMessages, messageID, usage)
      if (!delta) return false
      work.tokens += delta
      const at = Date.now()
      if (final || at - (work.lastUsagePersist ?? 0) >= 1_000) {
        work.lastUsagePersist = at
        void persist(work)
      }
      return true
    }

    // A managed worker session belongs to one step attempt, so its aggregate
    // session usage is a useful reconciliation when an event was missed or the
    // final turn had not reported yet. Never apply this to a fallback binding of
    // the human's session, because it would count unrelated turns.
    const reconcileTokens = async (work: ActiveWork): Promise<void> => {
      if (!work.managed || typeof ctx.session?.get !== 'function') return
      try {
        const info = await ctx.session.get({ sessionID: work.session })
        const total = tokenTotal(info?.tokens)
        if (total > work.tokens) {
          work.tokens = total
          work.lastUsagePersist = Date.now()
        }
      } catch {
        // Event usage remains the source of truth when session info is unavailable.
      }
    }

    const failMissingControl = async (work: ActiveWork): Promise<void> => {
      if (work.closed) return
      work.closed = true
      await reconcileTokens(work)
      try {
        const response = await call<Any>(
          config,
          'POST',
          `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/fail`,
          {
            work_token: work.work_token,
            error: 'The worker finished without calling a Clara control tool',
            usage: {
              turns: work.turns,
              toolCalls: work.toolCalls,
              tokens: work.tokens,
            },
          }
        )
        pruneRun(response.run)
      } catch (error) {
        console.error(
          `[clara-policy] failed to report a missing control call: ${(error as Error).message}`
        )
      }
      finish(work.session, true)
    }

    // A text-only answer is not a completed work order. Give the worker one
    // corrective turn, then record the final answer so correct work is not
    // thrown away. Routers still fail: a missing route key cannot be inferred.
    const completeInferred = async (work: ActiveWork): Promise<void> => {
      if (work.closed) return
      const text = work.lastText?.trim()
      if (!text) {
        await failMissingControl(work)
        return
      }
      work.closed = true
      await reconcileTokens(work)
      try {
        const response = await call<Any>(
          config,
          'POST',
          `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/complete`,
          {
            work_token: work.work_token,
            result: { summary: text, inferred: true },
            usage: {
              turns: work.turns,
              toolCalls: work.toolCalls,
              tokens: work.tokens,
            },
          }
        )
        pruneRun(response.run)
        console.warn(`[clara-policy] completed ${work.step_path} from the final answer`)
      } catch (error) {
        console.error(
          `[clara-policy] failed to complete ${work.step_path}: ${(error as Error).message}`
        )
      }
      finish(work.session, true)
    }

    const watchControl = (session: string, work: ActiveWork): void => {
      if (!work.managed) return
      const sessions = ctx.session as Any
      if (typeof sessions?.wait !== 'function') return
      void (async () => {
        while (true) {
          try {
            await sessions.wait({ sessionID: session })
          } catch {
            finish(session, true)
            return
          }
          // Let a control tool that raced the idle event land first.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 500)
            timer.unref?.()
          })
          const plan = planMissingControl(work)
          if (plan === 'ignore') {
            // The step already ended through a control call. Reconcile the
            // final model turn while the session is idle and the binding still
            // exists, then release it without an interrupt or corrective prompt.
            await reconcileTokens(work)
            await persist(work)
            finish(session, true)
            return
          }
          if (plan === 'complete') return completeInferred(work)
          if (plan === 'fail') return failMissingControl(work)
          work.corrected = true
          try {
            await ctx.session.prompt({
              sessionID: session,
              text: MISSING_CONTROL_PROMPT,
              metadata: { source: 'clara', synthetic: true, clara: { run_id: work.run_id } },
              delivery: 'queue',
            })
          } catch {
            return failMissingControl(work)
          }
        }
      })().catch(() => {})
    }

    const register = async (): Promise<void> => {
      try {
        const settings = await call<{ workspace?: string | null }>(
          config,
          'GET',
          '/v1/config'
        ).catch(() => undefined)
        const workspace = settings?.workspace?.trim() || resolveWorkspace(ctx)
        configuredWorkspace = workspace
        const probe = await call(config, 'GET', '/v1/catalog').catch((error: unknown) => error)
        serviceNeedsWorkspace = needsExplicitWorkspace(probe)
        if (serviceNeedsWorkspace) {
          console.warn(
            '[clara-policy] orchestrator requires an explicit workspace; restart it with the current service build'
          )
        }
        const registered = await call<{ id: string }>(config, 'POST', '/v1/adapters/register', {
          harness: 'opencode',
          workspace,
          capabilities: CAPABILITIES,
        })
        adapterID = registered.id
        console.log(`[clara-policy] adapter ${adapterID} registered for ${workspace}`)
      } catch (error) {
        console.error(`[clara-policy] adapter registration failed: ${(error as Error).message}`)
      }
    }

    const bind = (session: string | undefined, work: Any, managed: boolean): void => {
      if (!session) return
      const runID = Number(work.run_id)
      const stepPath = String(work.step_path)
      // A retry gets a new managed session. Stop any worker that still owns
      // the previous attempt so it cannot keep running and mutating files.
      for (const [id, existing] of active) {
        if (id === session) continue
        if (existing.run_id !== runID || existing.step_path !== stepPath) continue
        existing.closed = true
        if (existing.beatTimer) clearInterval(existing.beatTimer)
        void stop(id)
        active.delete(id)
        lastTurn.delete(id)
      }
      const previous = active.get(session)
      if (previous?.beatTimer) clearInterval(previous.beatTimer)
      const entry: ActiveWork = {
        run_id: runID,
        step_path: stepPath,
        work_token: String(work.work_token),
        name: String(work.name),
        session,
        workspace: String(work.workspace ?? currentWorkspace()),
        enforcement: String(work.enforcement ?? 'observed'),
        kind: String(work.kind ?? 'task'),
        routes: Array.isArray(work.routes)
          ? work.routes.flatMap((route: Any) =>
              typeof route?.when === 'string' && route.when ? [{ when: route.when }] : []
            )
          : [],
        managed,
        ...(typeof work.model === 'string' && work.model ? { model: work.model } : {}),
        ...(typeof work.provider === 'string' && work.provider ? { provider: work.provider } : {}),
        turns: 0,
        toolCalls: 0,
        tokens: 0,
        tokenMessages: new Map(),
        closed: false,
        watching: false,
        corrected: false,
      }
      active.set(session, entry)
      entry.beatTimer = startStepHeartbeat(
        () =>
          call(
            config,
            'POST',
            `/v1/runs/${entry.run_id}/steps/${encodeURIComponent(entry.step_path)}/heartbeat`,
            { work_token: entry.work_token }
          ),
        {
          onLost: (error) => {
            entry.closed = true
            entry.beatTimer = undefined
            if (active.get(session) !== entry) return
            active.delete(session)
            lastTurn.delete(session)
            console.warn(`[clara-policy] releasing ${entry.step_path}: ${error.message}`)
            // A fallback binding shares the human's session. Never interrupt it;
            // only a managed worker belongs to the attempt that lost the lease.
            if (entry.managed) void stop(session)
          },
        }
      )
      activeRuns.add(runID)
    }

    const DEFAULT_WORKER_AGENT = 'build'

    // Managed workers run in top-level sessions, so the worker agent must be
    // usable as a primary agent. An invalid or subagent-only override falls
    // back to the built-in build agent instead of silently inheriting the
    // caller's agent.
    const resolveWorkerAgent = async (): Promise<string> => {
      const requested = process.env.CLARA_WORKER_AGENT?.trim() || DEFAULT_WORKER_AGENT
      const agents = ctx.agent as Any
      if (typeof agents?.get !== 'function') return requested
      try {
        const info = await agents.get({ agentID: requested })
        const mode =
          info && typeof info === 'object' ? (info as { mode?: unknown }).mode : undefined
        if (info && mode !== 'subagent') return requested
        console.warn(
          `[clara-policy] worker agent ${requested} is not a primary agent; using ${DEFAULT_WORKER_AGENT}`
        )
      } catch {
        console.warn(
          `[clara-policy] worker agent ${requested} is unavailable; using ${DEFAULT_WORKER_AGENT}`
        )
      }
      return DEFAULT_WORKER_AGENT
    }

    const dispatch = async (work: Any, context: Any): Promise<boolean> => {
      if (!ctx.session?.create || !ctx.session?.prompt) return false
      const parentSession = sessionID(context)
      const directory =
        typeof work?.workspace === 'string' && work.workspace ? work.workspace : currentWorkspace()
      const agent = await resolveWorkerAgent()
      const model = modelRef(work)
      if (
        (typeof work?.model === 'string' && work.model && !model) ||
        (typeof work?.provider === 'string' && work.provider && !model)
      ) {
        console.error(
          `[clara-policy] ${work.step_path} has an incomplete model reference (provider=${work.provider ?? '-'} model=${work.model ?? '-'}); using the harness default`
        )
      }
      try {
        const created = await ctx.session.create({
          title: `Clara ${work.name} (run ${work.run_id})`,
          location: { directory },
          agent,
          ...(model ? { model } : {}),
          metadata: {
            automation: true,
            clara: {
              run_id: work.run_id,
              step_path: work.step_path,
              managed: true,
            },
          },
        })
        if (typeof ctx.session.get === 'function') {
          let info = await ctx.session.get({ sessionID: created.id })
          if (!info) throw new Error(`managed session ${created.id} was not persisted`)
          if (info.agent && info.agent !== agent && typeof ctx.session.switchAgent === 'function') {
            await ctx.session.switchAgent({ sessionID: created.id, agent })
            info = await ctx.session.get({ sessionID: created.id })
          }
          if (
            model &&
            (info.model?.providerID !== model.providerID || info.model?.id !== model.id) &&
            typeof ctx.session.switchModel === 'function'
          ) {
            await ctx.session.switchModel({ sessionID: created.id, model })
            info = await ctx.session.get({ sessionID: created.id })
          }
          if (info.agent && info.agent !== agent) {
            throw new Error(`managed session ${created.id} uses agent ${info.agent}, not ${agent}`)
          }
          if (
            model &&
            (info.model?.providerID !== model.providerID || info.model?.id !== model.id)
          ) {
            throw new Error(
              `managed session ${created.id} uses model ${info.model?.providerID ?? '-'}/${info.model?.id ?? '-'}, not ${model.providerID}/${model.id}`
            )
          }
          if (info.location?.directory && resolve(info.location.directory) !== resolve(directory)) {
            throw new Error(
              `managed session ${created.id} is at ${info.location.directory}, not ${directory}`
            )
          }
        }
        bind(created.id, work, true)
        await ctx.session.prompt({
          sessionID: created.id,
          text: renderWorkPrompt(work),
          metadata: { source: 'clara', synthetic: true, clara: { run_id: work.run_id } },
          delivery: 'queue',
        })
        return true
      } catch (error) {
        console.error(`[clara-policy] dispatch failed: ${(error as Error).message}`)
        if (parentSession) bind(parentSession, work, false)
        return false
      }
    }

    const dispatchWork = async (work: Any[], context: Any): Promise<unknown[]> => {
      const dispatched: unknown[] = []
      for (const order of work) {
        if (await dispatch(order, context)) {
          dispatched.push({ run_id: order.run_id, step_path: order.step_path, session: 'managed' })
        } else {
          dispatched.push(order)
        }
      }
      return dispatched
    }

    // Resume dispatch after an OpenCode or plugin restart. The orchestrator keeps
    // the run state; the adapter only needs the run ids to keep claiming work.
    const adoptRuns = async (): Promise<void> => {
      try {
        const runs = await call<DeliveryRun[]>(config, 'GET', '/v1/runs?summary=1')
        const current = resolve(currentWorkspace())
        let adopted = 0
        for (const run of runs) {
          if (!run || run.origin_harness !== 'opencode') continue
          if (run.workspace && resolve(run.workspace) !== current) continue
          const runID = Number(run.id)
          if (!Number.isFinite(runID)) continue
          if (isTerminalState(String(run.state))) {
            // A fresh install should not replay every historical result.
            // Later restarts may still deliver a run that finished while the
            // plugin was down.
            if (!hadDeliveryState && run.parent_run_id == null) delivery.runs.add(runID)
            continue
          }
          activeRuns.add(runID)
          adopted += 1
        }
        if (!hadDeliveryState) writeDeliveryState(delivery)
        if (adopted) console.log(`[clara-policy] adopted ${adopted} active run(s)`)
      } catch (error) {
        console.error(`[clara-policy] run adoption failed: ${(error as Error).message}`)
      }
    }

    const usableOrigin = async (origin: string): Promise<boolean> => {
      const sessions = ctx.session as Any
      if (typeof sessions?.get !== 'function') return true
      try {
        const info = await sessions.get({ sessionID: origin })
        if (!info) return false
        if (info.time?.archived != null) return false
        if (info.parentID) return false
        if (info.metadata?.automation === true) return false
        const agent = typeof info.agent === 'string' ? info.agent : ''
        return !INTERFACE_AGENT || !agent || agent === INTERFACE_AGENT
      } catch {
        return false
      }
    }

    const sessions = ctx.session as Any
    const deliverRuns = sessions?.prompt
      ? createDeliveryCycle({
          load: async () => {
            const current = resolve(currentWorkspace())
            const [runs, alerts] = await Promise.all([
              call<DeliveryRun[]>(config, 'GET', '/v1/runs?summary=1'),
              call<DeliveryAlert[]>(config, 'GET', '/v1/inbox'),
            ])
            return {
              runs: runs.filter(
                (run) =>
                  run.origin_harness === 'opencode' &&
                  (!run.workspace || resolve(run.workspace) === current)
              ),
              alerts,
            }
          },
          usableOrigin,
          deliver: async (message) => {
            await sessions.prompt({
              sessionID: message.sessionID,
              text: message.text,
              metadata: {
                source: 'clara',
                synthetic: true,
                clara: {
                  run_id: message.runID,
                  ...(message.alertIDs.length ? { alerts: message.alertIDs } : {}),
                  delivery: message.terminal ? 'result' : 'escalation',
                },
              },
              delivery: 'queue',
            })
          },
          state: delivery,
          persist: () => writeDeliveryState(delivery),
          interfaceAgent: INTERFACE_AGENT,
          onError: (message) => console.error(`[clara-policy] delivery failed: ${message}`),
        })
      : async (): Promise<void> => {}

    const checkTool = async (work: ActiveWork, name: string, args: Any): Promise<void> => {
      if (work.closed) throw new Error('Clara policy: the step is no longer running')
      const action = name === 'task' ? 'task' : name === 'shell' || name === 'bash' ? 'shell' : name
      const resources: string[] = []
      if (typeof args?.filePath === 'string') resources.push(args.filePath)
      if (typeof args?.path === 'string') resources.push(args.path)
      if (typeof args?.command === 'string') resources.push(args.command)
      let decision: { effect: string; reason?: string; closed?: boolean } | undefined
      try {
        decision = await call<{ effect: string; reason?: string; closed?: boolean }>(
          config,
          'POST',
          `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/check`,
          {
            action,
            tool: name,
            ...(resources.length ? { resources } : {}),
            ...(typeof args?.command === 'string' ? { command: args.command } : {}),
            ...(typeof args?.url === 'string' ? { network: args.url } : {}),
            work_token: work.work_token,
            usage: {
              turns: work.turns,
              toolCalls: work.toolCalls,
              tokens: work.tokens,
            },
          }
        )
      } catch (error) {
        if (work.enforcement === 'observed') return
        work.closed = true
        void stop(work.session)
        throw new Error(`Clara policy: policy check unavailable (${(error as Error).message})`, {
          cause: error,
        })
      }
      if (decision?.closed) {
        work.closed = true
        void stop(work.session)
      }
      if (decision?.effect === 'deny') {
        throw new Error(`Clara policy: ${decision.reason ?? `tool ${name} is denied`}`)
      }
    }

    await register()
    await adoptRuns()
    void deliverRuns()
    const heartbeat = setInterval(() => {
      if (adapterID)
        void call(config, 'POST', `/v1/adapters/${adapterID}/heartbeat`).catch(() => {})
    }, 30_000)
    heartbeat.unref?.()

    // A turn starts when OpenCode builds the model context for a session.
    let turnsFromContext = false
    if (typeof ctx.session?.hook === 'function') {
      await ctx.session
        .hook('context', async (event: Any) => {
          const id = typeof event?.sessionID === 'string' ? event.sessionID : undefined
          if (!id || !active.has(id)) return
          const work = active.get(id) as ActiveWork
          // Hide tools the step does not own before the model sees the request.
          // Only adapter-created sessions are scoped; a fallback binding of the
          // parent session must keep the human-facing agent's tool set.
          scopeWorkerTools(event?.tools, work)
          if (!work.watching) {
            work.watching = true
            watchControl(id, work)
          }
          const at = Date.now()
          if (at - (lastTurn.get(id) ?? 0) < 250) return
          lastTurn.set(id, at)
          work.turns += 1
          turnsFromContext = true
          // The previous turn's usage is final when the next context is built.
          await reconcileTokens(work)
          await persist(work)
        })
        .catch(() => {})
    }

    // Track the latest assistant text for the completion fallback, and count
    // turns from message events when the context hook is unavailable.
    if (typeof ctx.event?.subscribe === 'function') {
      try {
        const subscription = ctx.event.subscribe((event: Any) => {
          const type = String(event?.type ?? '')
          const tokenEvent = tokensFromEvent(event)
          if (tokenEvent) {
            const bound = active.get(tokenEvent.sessionID)
            if (bound) {
              applyTokens(bound, tokenEvent.messageID, tokenEvent.usage, tokenEvent.final)
            }
          }
          // A step event carries no other state the adapter needs here.
          if (type === 'session.step.ended' || type === 'session.step.failed') return
          if (type !== 'message.updated' && type !== 'message.part.updated') return
          const part = event?.properties?.part
          if (
            type === 'message.part.updated' &&
            part?.type === 'text' &&
            typeof part.text === 'string' &&
            part.text.trim()
          ) {
            const id = String(event?.properties?.sessionID ?? part.sessionID ?? '')
            const bound = id ? active.get(id) : undefined
            if (bound) bound.lastText = part.text
          }
          if (turnsFromContext) return
          const info = event?.properties?.info ?? part
          if (!info || info.role !== 'assistant') return
          const messageID = String(info.id ?? '')
          if (messageID && seenMessages.has(messageID)) return
          if (messageID) seenMessages.add(messageID)
          const id = String(event?.properties?.sessionID ?? info.sessionID ?? '')
          if (!id || !active.has(id)) return
          const work = active.get(id) as ActiveWork
          work.turns += 1
          void persist(work)
        })
        if (subscription && typeof subscription.catch === 'function') {
          await subscription.catch(() => {})
        }
      } catch (error) {
        console.error(`[clara-policy] event subscription unavailable: ${(error as Error).message}`)
      }
    }

    if (typeof ctx.tool?.hook === 'function') {
      await ctx.tool
        .hook('execute.before', async (event: Any) => {
          const id = typeof event?.sessionID === 'string' ? event.sessionID : sessionID(event)
          if (!id || !active.has(id)) return
          const work = active.get(id) as ActiveWork
          work.toolCalls += 1
          await checkTool(work, String(event?.tool ?? 'tool'), event?.input ?? event?.args ?? {})
          await persist(work)
        })
        .catch(() => {})
    }

    if (typeof ctx.permission?.hook === 'function') {
      await ctx.permission
        .hook('evaluate', async (event: Any) => {
          const id = typeof event?.sessionID === 'string' ? event.sessionID : undefined
          if (!id || !active.has(id)) return
          if (event.effect === 'deny') return
          const work = active.get(id) as ActiveWork
          if (work.closed) {
            event.effect = 'deny'
            event.message = 'Clara policy: the step is no longer running'
            return
          }
          let decision: { effect: string; reason?: string; closed?: boolean } | undefined
          try {
            decision = await call<{ effect: string; reason?: string; closed?: boolean }>(
              config,
              'POST',
              `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/check`,
              {
                action: String(event.action ?? 'tool'),
                resources: Array.isArray(event.resources) ? event.resources : [],
                work_token: work.work_token,
                usage: {
                  turns: work.turns,
                  toolCalls: work.toolCalls,
                  tokens: work.tokens,
                },
              }
            )
          } catch (error) {
            if (work.enforcement === 'observed') return
            work.closed = true
            void stop(work.session)
            event.effect = 'deny'
            event.message = `Clara policy: policy check unavailable (${(error as Error).message})`
            return
          }
          if (decision?.closed) {
            work.closed = true
            void stop(work.session)
          }
          if (decision?.effect === 'deny') {
            event.effect = 'deny'
            event.message = decision.reason ?? 'Denied by Clara policy'
          }
        })
        .catch(() => {})
    }

    // Poll for ready work in known runs. This is how background steps and
    // spawned children get their managed sessions.
    const dispatchTimer = setInterval(() => {
      void (async () => {
        for (const runID of activeRuns) {
          try {
            const work = await call<Any[]>(config, 'POST', `/v1/runs/${runID}/next`, { limit: 8 })
            if (work.length) {
              await dispatchWork(work, ctx)
              continue
            }
            const run = await call<{ id: number; state: string }>(
              config,
              'GET',
              `/v1/runs/${runID}`
            )
            pruneRun(run)
          } catch {
            // The service may be restarting.
          }
        }
      })()
    }, 2_000)
    dispatchTimer.unref?.()

    // Wake the origin session for new alerts and finished root runs. The
    // orchestrator owns the state; this timer only bridges it back to chat.
    const deliveryTimer = setInterval(() => {
      void deliverRuns()
    }, 3_000)
    deliveryTimer.unref?.()

    await ctx.tool.transform((editor: Any) => {
      editor.namespace({
        name: NAMESPACE,
        description:
          'Clara orchestration: start pipelines, relay results, and enforce step policy.',
      })

      editor.add(
        tool(
          'start',
          'Start the configured Clara entry for a concrete work request. The orchestrator owns the workspace and entry point; pass only the request. Do not call for status, questions, or an existing run.',
          START_TOOL_INPUT,
          async (input: Any, context: Any) => {
            const agent = typeof context?.agent === 'string' ? context.agent : ''
            if (INTERFACE_AGENT && agent && agent !== INTERFACE_AGENT) {
              throw new Error(`Clara: start runs from the ${INTERFACE_AGENT} agent, not ${agent}.`)
            }
            const started = await call<Any>(config, 'POST', '/v1/runs', {
              prompt: input.prompt,
              ...(serviceNeedsWorkspace && configuredWorkspace
                ? { workspace: configuredWorkspace }
                : {}),
              origin: {
                session_id: sessionID(context) ?? null,
                harness: 'opencode',
                agent: agent || null,
                kind: 'human',
              },
            })
            activeRuns.add(Number(started.run.id))
            const dispatched = await dispatchWork(started.work ?? [], context)
            return content({
              run: started.run,
              dispatched,
              note: 'The pipeline is dispatched. Reply to the human with the run id and stop; managed workers will report results. Do not poll unless the human asks.',
            })
          }
        )
      )

      editor.add(
        tool(
          'next',
          'Claim and dispatch the next ready work order(s) for a run.',
          {
            type: 'object',
            properties: {
              run_id: { type: 'number' },
              limit: { type: 'number' },
            },
            required: ['run_id'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            activeRuns.add(Number(input.run_id))
            const work = await call<Any[]>(config, 'POST', `/v1/runs/${input.run_id}/next`, {
              limit: input.limit ?? 1,
            })
            return content(await dispatchWork(work, context))
          }
        )
      )

      editor.add(
        tool(
          'complete',
          'Record a step result and advance the pipeline.',
          {
            type: 'object',
            properties: {
              result: {},
            },
            required: ['result'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = boundWork(active, context)
            await reconcileTokens(work)
            const path = `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/complete`
            const response = await call<Any>(config, 'POST', path, {
              work_token: work.work_token,
              result: input.result,
              usage: {
                turns: work.turns,
                toolCalls: work.toolCalls,
                tokens: work.tokens,
              },
            })
            pruneRun(response.run)
            finish(id)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'fail',
          'Record a step failure.',
          {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
            required: ['error'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = boundWork(active, context)
            await reconcileTokens(work)
            const path = `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/fail`
            const response = await call<Any>(config, 'POST', path, {
              work_token: work.work_token,
              error: input.error,
              usage: {
                turns: work.turns,
                toolCalls: work.toolCalls,
                tokens: work.tokens,
              },
            })
            pruneRun(response.run)
            finish(id)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'route',
          'Choose one route for a router step. Pass only the route key.',
          {
            type: 'object',
            properties: {
              route: { type: 'string' },
            },
            required: ['route'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = boundWork(active, context)
            // route() does not accept usage, so persist the final router usage
            // while the step still owns its lease.
            await reconcileTokens(work)
            await persist(work)
            const path = `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/route`
            const response = await call<Any>(config, 'POST', path, {
              work_token: work.work_token,
              route: input.route,
            })
            pruneRun(response.run)
            finish(id)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'spawn',
          'Create managed child work orders for dynamic fan-out.',
          {
            type: 'object',
            properties: {
              count: { type: 'number' },
              prompt: { type: 'string' },
              model: { type: 'string' },
              provider: { type: 'string' },
            },
            required: ['count', 'prompt'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = boundWork(active, context)
            const path = `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/spawn`
            const response = await call<Any>(config, 'POST', path, {
              run_id: work.run_id,
              step_path: work.step_path,
              work_token: work.work_token,
              count: input.count,
              prompt: input.prompt,
              ...(input.model ? { model: input.model } : work.model ? { model: work.model } : {}),
              ...(input.provider
                ? { provider: input.provider }
                : work.provider
                  ? { provider: work.provider }
                  : {}),
            })
            for (const child of response.children ?? []) activeRuns.add(Number(child.id))
            finish(id)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'status',
          'Read a run and its work tree. Use for status questions; never to start work.',
          {
            type: 'object',
            properties: { run_id: { type: 'number' } },
            required: ['run_id'],
            additionalProperties: false,
          },
          async (input: Any) => {
            const response = await call<Any>(config, 'GET', `/v1/runs/${input.run_id}`)
            pruneRun(response.run)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'list',
          'List recent root orchestration runs. Use for status questions.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () => {
            const runs = await call<Any[]>(config, 'GET', '/v1/runs?summary=1')
            return content(runs.filter((run) => run?.parent_run_id == null))
          }
        )
      )

      editor.add(
        tool(
          'inbox',
          'List open orchestration alerts. Use to answer what needs attention.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () => content(await call(config, 'GET', '/v1/inbox'))
        )
      )

      editor.add(
        tool(
          'ack',
          'Resolve an open alert after the human acknowledges it. It does not retry the run.',
          {
            type: 'object',
            properties: { alert_id: { type: 'number' } },
            required: ['alert_id'],
            additionalProperties: false,
          },
          async (input: Any) =>
            content(await call(config, 'POST', `/v1/alerts/${input.alert_id}/ack`))
        )
      )

      editor.add(
        tool(
          'cancel',
          'Cancel a run and its child runs. Use only on an explicit human request.',
          {
            type: 'object',
            properties: { run_id: { type: 'number' }, reason: { type: 'string' } },
            required: ['run_id'],
            additionalProperties: false,
          },
          async (input: Any) => {
            const response = await call<Any>(config, 'POST', `/v1/runs/${input.run_id}/cancel`, {
              reason: input.reason ?? 'human',
            })
            for (const [id, work] of active) {
              if (work.run_id !== Number(input.run_id)) continue
              work.closed = true
              void stop(id)
              active.delete(id)
              lastTurn.delete(id)
            }
            activeRuns.delete(Number(input.run_id))
            // The human already got the cancellation response. Do not queue a
            // second terminal message for the same run.
            delivery.runs.add(Number(input.run_id))
            writeDeliveryState(delivery)
            return content(response)
          }
        )
      )

      editor.add(
        tool(
          'tick',
          'Run the deterministic watchdog once.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () => content(await call(config, 'POST', '/v1/tick'))
        )
      )

      editor.add(
        tool(
          'check',
          'Check a tool, path, shell command, or network target against the step policy.',
          {
            type: 'object',
            properties: {
              run_id: { type: 'number' },
              step_path: { type: 'string' },
              action: { type: 'string' },
              tool: { type: 'string' },
              resources: { type: 'array', items: { type: 'string' } },
              command: { type: 'string' },
              network: { type: 'string' },
            },
            required: ['run_id', 'step_path', 'action'],
            additionalProperties: false,
          },
          async (input: Any) =>
            content(
              await call(
                config,
                'POST',
                `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/check`,
                input
              )
            )
        )
      )

      editor.add(
        tool(
          'catalog',
          'Read the resolved package catalog for the configured workspace. Use to answer what Clara can run.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () =>
            content(
              await call(
                config,
                'GET',
                catalogPath(serviceNeedsWorkspace ? configuredWorkspace : undefined)
              )
            )
        )
      )
    })

    console.log('[clara-policy] strict adapter ready')

    return () => {
      clearInterval(heartbeat)
      clearInterval(dispatchTimer)
      clearInterval(deliveryTimer)
      for (const work of active.values()) {
        if (work.beatTimer) clearInterval(work.beatTimer)
      }
      active.clear()
      if (adapterID) void call(config, 'DELETE', `/v1/adapters/${adapterID}`).catch(() => {})
    }
  },
}
