// Clara strict enforcement adapter for OpenCode.
//
// This plugin is both a tool surface and a policy enforcement point. It talks
// to the local Clara orchestrator over loopback HTTP, registers itself as an
// adapter, dispatches pipeline work into managed child sessions, and checks
// every tool call against the current step policy.
//
// Install it next to the MCP bridge when a workspace uses `enforcement: strict`.
// The MCP bridge remains the generic surface for other harnesses.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAMESPACE = 'clara'
const CAPABILITIES = ['tool_policy', 'path_policy', 'shell_policy', 'turn_limit', 'token_limit']

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
  turns: number
  toolCalls: number
  tokens: number
  violations: number
  lastTurnAt: number
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
    const error = parsed as { error?: { message?: string } } | undefined
    throw new Error(error?.error?.message ?? `Clara orchestrator returned ${response.status}`)
  }
  return parsed as T
}

function tool(
  name: string,
  description: string,
  input: Record<string, unknown>,
  execute: (input: Any, context: Any) => Promise<{ content: unknown }>
) {
  return { name, description, input, execute, options: { namespace: NAMESPACE } }
}

function sessionID(context: Any): string | undefined {
  return typeof context?.sessionID === 'string' ? context.sessionID : undefined
}

function workspace(context: Any): string {
  return (
    process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ||
    (typeof context?.workspace === 'string' ? context.workspace : '') ||
    (typeof context?.location?.directory === 'string' ? context.location.directory : '') ||
    process.cwd()
  )
}

function promptFor(work: Any): string {
  return `${work.prompt}

---
Clara work order
run_id: ${work.run_id}
step_path: ${work.step_path}
work_token: ${work.work_token}
attempt: ${work.attempt}/${work.max_attempts}
enforcement: ${work.enforcement}

When you finish, call clara_complete with these exact identifiers and a concise result.
If you are blocked, call clara_fail. Do not call clara_complete unless the work is actually done.
${work.routes ? `Available routes: ${work.routes.map((route: Any) => route.when).join(', ')}. Call clara_route with one of them.` : ''}
`
}

export default {
  id: 'clara-policy',

  async setup(ctx: Any) {
    const config = serviceConfig()
    const active = new Map<string, ActiveWork>()
    const seenMessages = new Set<string>()
    const activeRuns = new Set<number>()
    let adapterID: string | undefined
    let lastTurn = 0

    const persist = async (work: ActiveWork): Promise<void> => {
      await call(
        config,
        'POST',
        `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/usage`,
        {
          usage: {
            turns: work.turns,
            toolCalls: work.toolCalls,
            tokens: work.tokens,
            violations: work.violations,
          },
        }
      ).catch(() => {})
    }

    const register = async (): Promise<void> => {
      try {
        const registered = await call<{ id: string }>(config, 'POST', '/v1/adapters/register', {
          harness: 'opencode',
          workspace: workspace(ctx),
          capabilities: CAPABILITIES,
        })
        adapterID = registered.id
        console.log(`[clara-policy] adapter ${adapterID} registered for ${workspace(ctx)}`)
      } catch (error) {
        console.error(`[clara-policy] adapter registration failed: ${(error as Error).message}`)
      }
    }

    const bind = (session: string | undefined, work: Any): void => {
      if (!session) return
      active.set(session, {
        run_id: Number(work.run_id),
        step_path: String(work.step_path),
        work_token: String(work.work_token),
        name: String(work.name),
        turns: 0,
        toolCalls: 0,
        tokens: 0,
        violations: 0,
        lastTurnAt: 0,
      })
      activeRuns.add(Number(work.run_id))
    }

    const dispatch = async (work: Any, context: Any): Promise<boolean> => {
      if (!ctx.session?.create || !ctx.session?.prompt || !ctx.session?.switchAgent) return false
      const parentSession = sessionID(context)
      try {
        const created = await ctx.session.create({
          title: `Clara ${work.name} (run ${work.run_id})`,
          location: { directory: workspace(context) },
          metadata: {
            automation: true,
            clara: {
              run_id: work.run_id,
              step_path: work.step_path,
              managed: true,
            },
          },
        })
        await ctx.session.switchAgent({
          sessionID: created.id,
          agent: typeof context?.agent === 'string' ? context.agent : 'general',
        })
        bind(created.id, work)
        await ctx.session.prompt({
          sessionID: created.id,
          text: promptFor(work),
          metadata: { source: 'clara', synthetic: true, clara: { run_id: work.run_id } },
          delivery: 'queue',
        })
        return true
      } catch (error) {
        console.error(`[clara-policy] dispatch failed: ${(error as Error).message}`)
        if (parentSession) bind(parentSession, work)
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

    const reportDenied = async (work: ActiveWork, reason: string): Promise<void> => {
      work.violations += 1
      await call(
        config,
        'POST',
        `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/violation`,
        {
          reason,
        }
      ).catch(() => {})
      await persist(work)
    }

    const checkTool = async (work: ActiveWork, name: string, args: Any): Promise<void> => {
      const action = name === 'task' ? 'task' : name === 'shell' || name === 'bash' ? 'shell' : name
      const resources: string[] = []
      if (typeof args?.filePath === 'string') resources.push(args.filePath)
      if (typeof args?.path === 'string') resources.push(args.path)
      if (typeof args?.command === 'string') resources.push(args.command)
      const decision = await call<{ effect: string; reason?: string }>(
        config,
        'POST',
        `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/check`,
        {
          action,
          tool: name,
          ...(resources.length ? { resources } : {}),
          ...(typeof args?.command === 'string' ? { command: args.command } : {}),
          ...(typeof args?.url === 'string' ? { network: args.url } : {}),
          usage: {
            turns: work.turns,
            toolCalls: work.toolCalls,
            tokens: work.tokens,
            violations: work.violations,
          },
        }
      ).catch(() => undefined)
      if (decision?.effect === 'deny') {
        await reportDenied(work, decision.reason ?? `tool ${name} denied`)
        throw new Error(`Clara policy: ${decision.reason ?? `tool ${name} is denied`}`)
      }
    }

    await register()
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
          if (Date.now() - lastTurn < 250) return
          lastTurn = Date.now()
          const work = active.get(id) as ActiveWork
          work.turns += 1
          turnsFromContext = true
          await persist(work)
        })
        .catch(() => {})
    }

    // Fall back to message events when the session context hook is unavailable.
    if (!turnsFromContext && typeof ctx.event?.subscribe === 'function') {
      await ctx.event
        .subscribe((event: Any) => {
          const type = String(event?.type ?? '')
          if (type !== 'message.updated' && type !== 'message.part.updated') return
          const info = event?.properties?.info ?? event?.properties?.part
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
        .catch(() => {})
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
          const decision = await call<{ effect: string; reason?: string }>(
            config,
            'POST',
            `/v1/runs/${work.run_id}/steps/${encodeURIComponent(work.step_path)}/check`,
            {
              action: String(event.action ?? 'tool'),
              resources: Array.isArray(event.resources) ? event.resources : [],
              usage: {
                turns: work.turns,
                toolCalls: work.toolCalls,
                tokens: work.tokens,
                violations: work.violations,
              },
            }
          ).catch(() => undefined)
          if (decision?.effect === 'deny') {
            event.effect = 'deny'
            event.message = decision.reason ?? 'Denied by Clara policy'
            await reportDenied(work, event.message)
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
            if (!work.length) continue
            await dispatchWork(work, ctx)
          } catch {
            // The service may be restarting.
          }
        }
      })()
    }, 2_000)
    dispatchTimer.unref?.()

    await ctx.tool.transform((editor: Any) => {
      editor.namespace({
        name: NAMESPACE,
        description:
          'Clara orchestration: start pipelines, relay results, and enforce step policy.',
      })

      editor.add(
        tool(
          'start',
          'Start a Clara pipeline and dispatch its first work order.',
          {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              workspace: { type: 'string' },
              target: { type: 'string' },
            },
            required: ['prompt'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const started = await call<Any>(config, 'POST', '/v1/runs', {
              prompt: input.prompt,
              workspace: input.workspace ?? workspace(context),
              ...(input.target ? { target: input.target } : {}),
              origin: {
                session_id: sessionID(context) ?? null,
                harness: 'opencode',
                agent: typeof context?.agent === 'string' ? context.agent : null,
                kind: 'human',
              },
            })
            activeRuns.add(Number(started.run.id))
            const dispatched = await dispatchWork(started.work ?? [], context)
            return {
              content: {
                run: started.run,
                dispatched,
                note: 'The pipeline is dispatched. Use clara_status to follow it; managed workers will report results.',
              },
            }
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
            const work = await call<Any[]>(config, 'POST', `/v1/runs/${input.run_id}/next`, {
              limit: input.limit ?? 1,
            })
            return { content: await dispatchWork(work, context) }
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
              run_id: { type: 'number' },
              step_path: { type: 'string' },
              work_token: { type: 'string' },
              result: {},
            },
            required: ['run_id', 'step_path', 'work_token', 'result'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = id ? active.get(id) : undefined
            const path = `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/complete`
            const response = await call<Any>(config, 'POST', path, {
              work_token: input.work_token,
              result: input.result,
              ...(work
                ? {
                    usage: {
                      turns: work.turns,
                      toolCalls: work.toolCalls,
                      tokens: work.tokens,
                      violations: work.violations,
                    },
                  }
                : {}),
            })
            if (id) active.delete(id)
            return { content: response }
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
              run_id: { type: 'number' },
              step_path: { type: 'string' },
              work_token: { type: 'string' },
              error: { type: 'string' },
            },
            required: ['run_id', 'step_path', 'work_token', 'error'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const work = id ? active.get(id) : undefined
            const path = `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/fail`
            const response = await call<Any>(config, 'POST', path, {
              work_token: input.work_token,
              error: input.error,
              ...(work
                ? {
                    usage: {
                      turns: work.turns,
                      toolCalls: work.toolCalls,
                      tokens: work.tokens,
                      violations: work.violations,
                    },
                  }
                : {}),
            })
            if (id) active.delete(id)
            return { content: response }
          }
        )
      )

      editor.add(
        tool(
          'route',
          'Choose a route for a router work order.',
          {
            type: 'object',
            properties: {
              run_id: { type: 'number' },
              step_path: { type: 'string' },
              work_token: { type: 'string' },
              route: { type: 'string' },
            },
            required: ['run_id', 'step_path', 'work_token', 'route'],
            additionalProperties: false,
          },
          async (input: Any, context: Any) => {
            const id = sessionID(context)
            const path = `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/route`
            const response = await call<Any>(config, 'POST', path, input)
            if (id) active.delete(id)
            return { content: response }
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
              run_id: { type: 'number' },
              step_path: { type: 'string' },
              work_token: { type: 'string' },
              count: { type: 'number' },
              prompt: { type: 'string' },
            },
            required: ['run_id', 'step_path', 'work_token', 'count', 'prompt'],
            additionalProperties: false,
          },
          async (input: Any) => {
            const path = `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/spawn`
            const response = await call<Any>(config, 'POST', path, input)
            for (const child of response.children ?? []) activeRuns.add(Number(child.id))
            return { content: response }
          }
        )
      )

      editor.add(
        tool(
          'status',
          'Read a run and its work tree.',
          {
            type: 'object',
            properties: { run_id: { type: 'number' } },
            required: ['run_id'],
            additionalProperties: false,
          },
          async (input: Any) => ({ content: await call(config, 'GET', `/v1/runs/${input.run_id}`) })
        )
      )

      editor.add(
        tool(
          'list',
          'List recent orchestration runs.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () => ({ content: await call(config, 'GET', '/v1/runs') })
        )
      )

      editor.add(
        tool(
          'inbox',
          'List open orchestration alerts.',
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          async () => ({ content: await call(config, 'GET', '/v1/inbox') })
        )
      )

      editor.add(
        tool(
          'ack',
          'Resolve an open alert.',
          {
            type: 'object',
            properties: { alert_id: { type: 'number' } },
            required: ['alert_id'],
            additionalProperties: false,
          },
          async (input: Any) => ({
            content: await call(config, 'POST', `/v1/alerts/${input.alert_id}/ack`),
          })
        )
      )

      editor.add(
        tool(
          'cancel',
          'Cancel a run and its child runs.',
          {
            type: 'object',
            properties: { run_id: { type: 'number' }, reason: { type: 'string' } },
            required: ['run_id'],
            additionalProperties: false,
          },
          async (input: Any) => ({
            content: await call(config, 'POST', `/v1/runs/${input.run_id}/cancel`, {
              reason: input.reason ?? 'human',
            }),
          })
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
          async () => ({ content: await call(config, 'POST', '/v1/tick') })
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
          async (input: Any) => ({
            content: await call(
              config,
              'POST',
              `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/check`,
              input
            ),
          })
        )
      )

      editor.add(
        tool(
          'catalog',
          'Read the resolved package catalog for a workspace.',
          {
            type: 'object',
            properties: { workspace: { type: 'string' } },
            additionalProperties: false,
          },
          async (input: Any, context: Any) => ({
            content: await call(
              config,
              'GET',
              `/v1/catalog?workspace=${encodeURIComponent(input.workspace ?? workspace(context))}`
            ),
          })
        )
      )
    })

    console.log('[clara-policy] strict adapter ready')

    return () => {
      clearInterval(heartbeat)
      clearInterval(dispatchTimer)
      if (adapterID) void call(config, 'DELETE', `/v1/adapters/${adapterID}`).catch(() => {})
    }
  },
}
