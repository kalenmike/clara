import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ClaraBackend } from './types.ts'

const usageSchema = z
  .object({
    turns: z.number().int().nonnegative().optional(),
    tokens: z.number().int().nonnegative().optional(),
    budgetTokens: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    violations: z.number().int().nonnegative().optional(),
  })
  .optional()

const originSchema = z
  .object({
    session_id: z.string().nullable().optional(),
    harness: z.string().nullable().optional(),
    agent: z.string().nullable().optional(),
    kind: z.enum(['human', 'agent', 'api', 'worker']).optional(),
  })
  .optional()

const text = (value: unknown) => {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const structuredContent = Array.isArray(value)
    ? { items: value }
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
  return {
    content: [{ type: 'text' as const, text: body }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

export const SERVER_INSTRUCTIONS = `You are connected to Clara's orchestration service through MCP.

The orchestrator owns the workspace and its configured entry point. Do not pass
a workspace or a pipeline target: clara_start always starts the configured
entry, and that entry routes the request.

MCP is the generic work-order surface. Calling clara_start does not dispatch a
background worker: it returns a work order that you must execute yourself.

To run a pipeline manually:
1. Call clara_start with the user's prompt.
2. Read the returned work order. Its prompt is the step instruction,
   context.prompt is the root request as background scope, context.inputs
   holds the results of the steps it declares, and context.artifacts lists
   workspace files to read. Do the work with your own tools.
3. Call clara_complete with the run_id, step_path, work_token, and result.
4. If the work order is a router, call clara_route with one of the supplied routes.
5. If you are blocked, call clara_fail.
6. If the step needs dynamic workers, call clara_spawn.

Do not call clara_start for status questions. Use clara_status, clara_list, or
clara_inbox instead.

The OpenCode adapter is conductor mode. When it is installed, the Clara agent
starts runs, background workers execute them, and the adapter delivers
escalations and results back into the origin session. MCP callers do not see
that dispatch receipt.

Never invent the next step; always use the response. The service owns state, leases, retries, budgets, and alerts.`

export function createClaraServer(backend: ClaraBackend, version = '0.1.0'): McpServer {
  const server = new McpServer({ name: 'clara', version }, { instructions: SERVER_INSTRUCTIONS })

  server.registerTool(
    'clara_start',
    {
      description:
        'Start the configured Clara entry point. Returns the first work order, its lease token, prompt, budget, and context.',
      inputSchema: {
        prompt: z.string().min(1).describe('The initial human or agent request'),
        origin: originSchema.describe('Who submitted the request'),
      },
    },
    async (args) => text(await backend.start(args))
  )

  server.registerTool(
    'clara_next',
    {
      description:
        'Claim and return the next ready work order(s). A work token is required to complete, fail, or route a step.',
      inputSchema: {
        run_id: z.number().int().positive(),
        limit: z.number().int().min(1).max(32).optional(),
      },
    },
    async (args) => text(await backend.next(args.run_id, args.limit))
  )

  server.registerTool(
    'clara_complete',
    {
      description:
        'Record a step result and advance the pipeline. The work token must belong to the current attempt.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
        result: z.unknown().describe('The step result: text, JSON object, artifacts, or evidence'),
        usage: usageSchema,
      },
    },
    async (args) => text(await backend.complete(args))
  )

  server.registerTool(
    'clara_fail',
    {
      description:
        'Record a step failure. The service retries until the attempt limit, then fails the run and opens an alert.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
        error: z.string().min(1),
        usage: usageSchema,
      },
    },
    async (args) => text(await backend.fail(args))
  )

  server.registerTool(
    'clara_route',
    {
      description: 'Choose a route for a router work order and continue the pipeline.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
        route: z.string().min(1),
      },
    },
    async (args) => text(await backend.route(args))
  )

  server.registerTool(
    'clara_spawn',
    {
      description:
        'Create managed child work orders for dynamic fan-out. The parent step waits, then resumes when all children finish.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
        count: z.number().int().min(1).max(32),
        prompt: z.string().min(1),
        model: z.string().optional(),
        provider: z.string().optional(),
        policy: z.unknown().optional(),
        limits: z.unknown().optional(),
      },
    },
    async (args) => text(await backend.spawn(args))
  )

  server.registerTool(
    'clara_status',
    {
      description:
        'Read a run, its steps, worker run tree, and open alerts. Advances ready work safely.',
      inputSchema: { run_id: z.number().int().positive() },
    },
    async (args) => text(await backend.status(args.run_id))
  )

  server.registerTool(
    'clara_attempts',
    {
      description:
        'Read the attempt history for a run or one step: outcome, usage, timings, error, and result per claim.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1).optional(),
      },
    },
    async (args) => text(await backend.attempts(args.run_id, args.step_path))
  )

  server.registerTool(
    'clara_list',
    {
      description: 'List recent orchestration runs.',
      inputSchema: {},
    },
    async () => text(await backend.list())
  )

  server.registerTool(
    'clara_inbox',
    {
      description: 'List open alerts across all runs.',
      inputSchema: {},
    },
    async () => text(await backend.inbox())
  )

  server.registerTool(
    'clara_ack',
    {
      description: 'Resolve an open alert by id.',
      inputSchema: { alert_id: z.number().int().positive() },
    },
    async (args) => text(await backend.ack(args.alert_id))
  )

  server.registerTool(
    'clara_cancel',
    {
      description: 'Cancel a run and all of its child runs. Completed runs cannot be cancelled.',
      inputSchema: {
        run_id: z.number().int().positive(),
        reason: z.string().min(1).optional(),
      },
    },
    async (args) => text(await backend.cancel(args.run_id, args.reason ?? 'human'))
  )

  server.registerTool(
    'clara_tick',
    {
      description:
        'Run the deterministic watchdog once. Retries expired or stalled leases and opens alerts. It does not advance healthy work.',
      inputSchema: {},
    },
    async () => text(await backend.tick())
  )

  server.registerTool(
    'clara_check',
    {
      description:
        'Policy enforcement point. Ask whether a tool, edit path, shell command, or network target is allowed for a step.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        action: z.string().min(1),
        tool: z.string().optional(),
        resources: z.array(z.string()).optional(),
        command: z.string().optional(),
        network: z.string().optional(),
        usage: usageSchema,
        work_token: z.string().min(1).optional(),
      },
    },
    async (args) => text(await backend.check(args))
  )

  server.registerTool(
    'clara_usage',
    {
      description:
        'Report turns, tool calls, tokens, or violations for a step and renew its lease.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
        usage: usageSchema.unwrap(),
      },
    },
    async (args) => text(await backend.usage(args))
  )

  server.registerTool(
    'clara_heartbeat',
    {
      description: 'Renew the lease and heartbeat for a running step.',
      inputSchema: {
        run_id: z.number().int().positive(),
        step_path: z.string().min(1),
        work_token: z.string().min(1),
      },
    },
    async (args) => text(await backend.heartbeat(args.run_id, args.step_path, args.work_token))
  )

  server.registerTool(
    'clara_catalog',
    {
      description:
        'Read the resolved package, pipeline, router, and task catalog for the configured workspace.',
      inputSchema: {},
    },
    async () => text(await backend.catalog())
  )

  server.registerTool(
    'clara_adapter_register',
    {
      description: 'Register a strict-enforcement adapter for a workspace.',
      inputSchema: {
        harness: z.string().min(1),
        workspace: z.string().min(1),
        session_id: z.string().nullable().optional(),
        capabilities: z.array(z.string()).min(1),
        id: z.string().optional(),
      },
    },
    async (args) => text(await backend.registerAdapter(args))
  )

  server.registerTool(
    'clara_adapters',
    {
      description: 'List registered enforcement adapters.',
      inputSchema: { workspace: z.string().optional() },
    },
    async (args) => text(await backend.adapters(args.workspace))
  )

  server.registerTool(
    'clara_adapter_heartbeat',
    {
      description: 'Heartbeat a registered enforcement adapter.',
      inputSchema: { id: z.string().min(1) },
    },
    async (args) => text(await backend.heartbeatAdapter(args.id))
  )

  server.registerTool(
    'clara_adapter_remove',
    {
      description: 'Remove a registered enforcement adapter.',
      inputSchema: { id: z.string().min(1) },
    },
    async (args) => text(await backend.removeAdapter(args.id))
  )

  server.registerResource(
    'inbox',
    'clara://inbox',
    { description: 'Open orchestration alerts', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await backend.inbox(), null, 2),
        },
      ],
    })
  )

  server.registerResource(
    'catalog',
    'clara://catalog',
    {
      description: 'Resolved package catalog for the default workspace',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await backend.catalog(), null, 2),
        },
      ],
    })
  )

  server.registerResource(
    'run',
    new ResourceTemplate('clara://runs/{runId}', {
      list: async () => ({ resources: [] }),
    }),
    { description: 'A single orchestration run', mimeType: 'application/json' },
    async (uri, variables) => {
      const runID = Number(variables.runId)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(await backend.status(runID), null, 2),
          },
        ],
      }
    }
  )

  return server
}
