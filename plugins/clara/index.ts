// Clara — OpenCode plugin.
//
// Registers the ledger tools. Nothing here is an agent: agents call these
// tools, the tools read and write the ledger, and the ledger is the only
// thing that crosses an agent boundary.
//
// OpenCode discovers this plugin from the global plugin directory after
// `pnpm clara plugin install`:
//
//   ~/.config/opencode/plugins/clara -> <repo>/plugins/clara
//
// The ledger lives at ${CLARA_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/clara}/ledger.db.
// Override it with CLARA_LEDGER_DB_PATH or the plugin `db` option:
//
//   { "plugins": [{ "package": "@clara/opencode-plugin", "options": { "db": "/path/ledger.db" } }] }
//
// OpenCode derives a tool id from `options.namespace`, not from
// `editor.namespace()`. Every tool below is registered with
// `options: { namespace: 'clara' }`, so the ids are `clara_submit`,
// `clara_inbox`, and so on. The `editor.namespace()` call only describes the
// group.

import {
  ATTENTION_STATES,
  attentionAnswer,
  attentionFields,
  attentionFormApi,
  waitForAttentionForm,
  type AttentionFormApi,
} from './attention.ts'
import { createDaemon } from './daemon.ts'
import { DEFAULT_DB_PATH, getDb, managementEnabled, type Db, type Row } from './db.ts'
import { ensurePipelineSnapshots } from './pipeline.ts'
import * as q from './queries.ts'

export const NAMESPACE = 'clara'

export type ClaraTool = {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (input: any, context: any) => Promise<{ content: unknown }>
}

/** The id OpenCode assigns to a tool registered in the clara namespace. */
export function toolId(name: string): string {
  return `${NAMESPACE}_${name}`
}

const requestRef = {
  anyOf: [{ type: 'string' }, { type: 'number' }],
  description: 'Request id (e.g. 42) or slug (e.g. remote-key-login)',
}

// Who is acting is decided by the live run behind the session, never by the
// arguments. A custom pipeline agent gets the role its stage declares; an
// unknown agent with no run gets no write privileges.
export type CallRole = 'human' | 'worker' | 'closer' | 'unknown'

export const ROLE_FOR_AGENT: Record<string, CallRole> = {
  '001': 'worker',
  '002': 'worker',
  '003': 'worker',
  '004': 'worker',
  'clara-brief': 'worker',
  'clara-writer': 'worker',
  'clara-editor': 'worker',
  judge: 'closer',
  clara: 'human',
}

export type CallContext = {
  agent: string
  role: CallRole
  actor: string
  run?: Row
}

function callContext(db: Db, context: any): CallContext {
  const agent = String(context?.agent ?? '').trim()
  const sessionID = typeof context?.sessionID === 'string' ? context.sessionID : undefined

  if (sessionID) {
    const run = db
      .prepare(
        `SELECT r.*, f.state AS request_state
           FROM runs r
           JOIN requests f ON f.id = r.request_id
          WHERE r.session_id = ? AND r.status IN ('starting', 'running')
          ORDER BY r.id DESC LIMIT 1`
      )
      .get(sessionID) as Row | undefined
    if (run) {
      const role = run.role === 'closer' ? 'closer' : 'worker'
      return { agent, role, actor: role === 'closer' ? 'ai_0' : 'worker', run }
    }
  }

  const role = ROLE_FOR_AGENT[agent] ?? 'unknown'
  return {
    agent,
    role,
    actor:
      role === 'human'
        ? 'human'
        : role === 'closer'
          ? 'ai_0'
          : role === 'worker'
            ? 'worker'
            : 'unknown',
  }
}

function requireRole(name: string, call: CallContext, allowed: CallRole[]): CallContext {
  if (!allowed.includes(call.role)) {
    throw new Error(
      `Clara: ${name} is not available to ${call.agent || 'unknown'} (role ${call.role}); ` +
        `allowed: ${allowed.join(', ')}`
    )
  }
  return call
}

function requireRunStage(call: CallContext, request: unknown, stage: unknown): void {
  if (!call.run) return
  if (Number(call.run.request_id) !== Number(request) || call.run.stage !== String(stage)) {
    throw new Error(
      `Clara: this session owns ${call.run.stage} for request ${call.run.request_id}, not ` +
        `${String(stage)} for request ${String(request)}`
    )
  }
}

/**
 * Build the ledger tools. `setup` registers them with OpenCode; `cli.ts` runs
 * the same definitions directly so a human can test a tool without an agent.
 *
 * `guard` is only passed by the plugin entry. It makes every tool inert when
 * Clara management is off, while leaving the CLI available for recovery.
 */
export function createTools(
  db: Db,
  guard?: () => Promise<boolean>,
  forms?: AttentionFormApi
): ClaraTool[] {
  ensurePipelineSnapshots(db)
  const tools: ClaraTool[] = [
    // -- human facing ------------------------------------------------------

    {
      name: 'submit',
      description:
        'Register a request. Creates the ledger row, the draft record in the workspace, and the first event. Nothing runs until the criteria are approved.',
      input: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Workspace name, e.g. clara' },
          path: {
            type: 'string',
            description: 'Absolute path to the workspace repo. Required the first time.',
          },
          title: { type: 'string' },
          intent: {
            type: 'string',
            description: 'What a user can do after this that they cannot do now',
          },
          why: { type: 'string', description: 'The outcome this serves' },
          non_goals: {
            type: 'array',
            items: { type: 'string' },
            description: 'What this explicitly is not. The highest-value field.',
          },
          constraints: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['now', 'next', 'whenever'] },
          not_worth_it: {
            type: 'string',
            description: 'The condition under which this request should be abandoned',
          },
          soft_budget: { type: 'number', description: 'Tokens. Above this, Clara must ask.' },
          hard_budget: { type: 'number', description: 'Tokens. Above this, Clara kills.' },
          time_limit_minutes: { type: 'number' },
          pipeline: {
            type: 'string',
            description: 'Pipeline id. Defaults to the workspace pipeline, then software.',
          },
        },
        required: ['workspace', 'title', 'intent'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('submit', callContext(db, context), ['human'])
        return {
          content: q.submit(db, {
            ...input,
            session_id: typeof context?.sessionID === 'string' ? context.sessionID : undefined,
          }),
        }
      },
    },

    {
      name: 'inbox',
      description:
        'List everything that needs a human: open decisions, stalled requests, requests over soft budget. Silent when nothing needs you.',
      input: {
        type: 'object',
        properties: { workspace: { type: 'string' } },
        additionalProperties: false,
      },
      execute: async (input: any) => ({ content: q.inbox(db, input ?? {}) }),
    },

    {
      name: 'attention',
      description:
        'Present a ledger exception to the human in this session. Use info when nothing is needed, feedback for a free-text answer, form for structured answers, and confirm for a go/no-go. The form doubles as the stale check: an already resolved alert is refused.',
      input: {
        type: 'object',
        properties: {
          alert: {
            type: 'string',
            description: 'Alert key from the ledger, e.g. decision:7 or approval:12',
          },
          state: {
            type: 'string',
            enum: [...ATTENTION_STATES],
            description:
              'info = no answer; feedback = free text; form = structured fields; confirm = go/no-go',
          },
          title: { type: 'string', description: 'Form title. Defaults to the alert title.' },
          prompt: {
            type: 'string',
            description: 'The question or confirmation label shown with the form.',
          },
          confirm_label: { type: 'string', description: 'Label for the confirm checkbox.' },
          fields: {
            type: 'array',
            description: 'Structured fields for state=form.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['string', 'number', 'integer', 'boolean', 'multiselect'],
                },
                required: { type: 'boolean' },
                placeholder: { type: 'string' },
                max_length: { type: 'number' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                      label: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['value', 'label'],
                  },
                },
              },
              required: ['key', 'type'],
            },
          },
        },
        required: ['alert', 'state'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('attention', callContext(db, context), ['human'])
        const alert = db.prepare('SELECT * FROM alerts WHERE key = ?').get(String(input.alert)) as
          Row | undefined
        if (!alert) return { content: `Clara: no alert "${input.alert}".` }

        const state = String(input.state)
        if (!ATTENTION_STATES.includes(state as (typeof ATTENTION_STATES)[number])) {
          throw new Error(`Clara: attention state must be one of ${ATTENTION_STATES.join(', ')}`)
        }

        const oneTime = String(alert.key).startsWith('cancelled:')
        if (state !== 'info' && alert.resolved_at && !oneTime) {
          return { content: `Clara: "${alert.key}" is already resolved. Nothing to ask.` }
        }

        if (state === 'info') {
          recordAttention(db, alert, 'info', { state })
          return {
            content:
              'Attention item recorded. Tell the human what happened and stop; do not ask for an answer.',
          }
        }

        if (!forms || typeof context?.sessionID !== 'string') {
          recordAttention(db, alert, 'text', { state })
          return {
            content:
              'No form API is available. Ask the human in prose, then wait for their reply. Do not act until they answer.',
          }
        }

        const created = await forms.create({
          sessionID: context.sessionID,
          title: String(input.title ?? alert.title),
          metadata: { clara: { attention: state, alert: String(alert.key) } },
          fields: attentionFields({ ...input, state }),
        })
        recordAttention(db, alert, 'opened', { state, form: created.id })

        const result = await waitForAttentionForm(forms, {
          sessionID: context.sessionID,
          formID: created.id,
          signal: context?.signal,
        })
        recordAttention(db, alert, result.status === 'answered' ? 'answered' : 'cancelled', {
          state,
          form: created.id,
          ...(result.status === 'answered'
            ? { answer: result.answer }
            : { reason: result.message ?? null }),
        })
        return { content: attentionAnswer(result) }
      },
    },

    {
      name: 'ask',
      description:
        'Read ledger state. Scope to one request, one workspace, or all. Returns facts only — never reads session history and never guesses.',
      input: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'What the human asked. Optional when scoped to a request; recorded only if unanswerable.',
          },
          request: requestRef,
          workspace: { type: 'string' },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
      execute: async (input: any) => ({ content: q.ask(db, input) }),
    },

    {
      name: 'approve',
      description:
        "Human approval of the proposed acceptance criteria. Moves the request from spec to planned. Never call this on the human's behalf.",
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          approved_by: { type: 'string' },
        },
        required: ['request'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('approve', callContext(db, context), ['human'])
        return { content: q.approve(db, input) }
      },
    },

    {
      name: 'gate',
      description:
        'Record that a human verified the human-gate criteria of a request in review. The judge closes only when every gate is recorded.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          criteria: {
            type: 'array',
            items: { type: 'number' },
            description: 'Gate positions. Defaults to every human gate.',
          },
          result: {
            type: 'string',
            enum: ['verified', 'rejected'],
            description: 'Defaults to verified.',
          },
          evidence: { type: 'string', description: 'What the human checked, in one line.' },
        },
        required: ['request'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('gate', callContext(db, context), ['human'])
        return { content: q.gate(db, input) }
      },
    },

    // -- spec agent (ai_1) -------------------------------------------------

    {
      name: 'criteria',
      description:
        'Propose the acceptance criteria. Each criterion needs a verification kind (automated, human, or artifact) with a check reference where relevant. Replaces any previous proposal.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                verification: {
                  type: 'string',
                  enum: ['automated', 'human', 'artifact'],
                },
                check: {
                  type: 'string',
                  description: 'Test path, command, artifact path, or other check reference.',
                },
                test_path: {
                  type: 'string',
                  description: 'Shorthand for verification=automated.',
                },
                human_gate: {
                  type: 'boolean',
                  description: 'Shorthand for verification=human.',
                },
              },
              required: ['text'],
              additionalProperties: false,
            },
          },
          kill_criteria: { type: 'array', items: { type: 'string' } },
          docs_impact: {
            type: 'string',
            description: 'Workspace docs that must change, or "none".',
          },
        },
        required: ['request', 'criteria'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('criteria', callContext(db, context), ['worker', 'human'])
        return { content: q.setCriteria(db, input) }
      },
    },

    // -- generic stages ----------------------------------------------------

    {
      name: 'stage_done',
      description:
        'Complete one pipeline stage with the evidence its definition requires. The daemon advances only after this call.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          stage: { type: 'string', description: 'Stage id from the pinned pipeline.' },
          evidence: {
            type: 'object',
            description: 'Evidence declared by the stage definition.',
            additionalProperties: true,
          },
        },
        required: ['request', 'stage'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        const call = requireRole('stage_done', callContext(db, context), ['worker', 'closer'])
        requireRunStage(call, input.request, input.stage)
        return { content: q.stageDone(db, { ...input, actor: call.actor }) }
      },
    },

    {
      name: 'stage_gate',
      description:
        'Record that a human verified or rejected a pipeline stage gate. Only stages that declare a gate accept this.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          stage: { type: 'string', description: 'Stage id from the pinned pipeline.' },
          result: { type: 'string', enum: ['verified', 'rejected'] },
          evidence: { type: 'string', description: 'What the human checked, in one line.' },
        },
        required: ['request', 'stage'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        const call = requireRole('stage_gate', callContext(db, context), ['human'])
        return { content: q.stageGate(db, { ...input, actor: call.actor }) }
      },
    },

    {
      name: 'progress',
      description:
        'Record a progress checkpoint for the active stage with arbitrary metrics, a blocker, a next step, and tokens.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          stage: { type: 'string', description: 'Stage id from the pinned pipeline.' },
          metrics: {
            type: 'object',
            description: 'Stage-specific metrics, for example test counts or word count.',
            additionalProperties: true,
          },
          blocked_on: { type: 'string' },
          next: { type: 'string' },
          open_question: { type: 'string' },
          tokens: { type: 'number' },
        },
        required: ['request', 'stage'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        const call = requireRole('progress', callContext(db, context), ['worker', 'closer'])
        requireRunStage(call, input.request, input.stage)
        return { content: q.progress(db, { ...input, actor: call.actor }) }
      },
    },

    // -- supervisor (ai_0) -------------------------------------------------

    {
      name: 'event',
      description:
        'Append an event and optionally transition state. Legal transitions only. Only the closer may complete or cancel a request; a human cancel uses clara_cancel.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          type: { type: 'string' },
          payload: { type: 'object' },
          state: {
            type: 'string',
            enum: ['draft', 'approved', 'running', 'review', 'completed', 'cancelled'],
          },
        },
        required: ['request', 'type'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        const call = requireRole('event', callContext(db, context), ['worker', 'closer', 'human'])
        return { content: q.appendEvent(db, { ...input, actor: call.actor }) }
      },
    },

    {
      name: 'cancel',
      description:
        "Cancel a request at the human's explicit instruction. Moves any non-terminal request to cancelled, records the reason, resolves its open decisions and alerts, and makes the daemon stop launching stages. Only Clara may use this tool; workers and the closer never can. Never call it on your own initiative.",
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          reason: {
            type: 'string',
            description: 'Short reason code or note. Defaults to "human".',
          },
        },
        required: ['request'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        // Cancellation belongs to the human-facing Clara agent. The `human`
        // role is only mapped to Clara today. A future recursive pipeline must
        // keep this privilege at the highest level: a worker or sub-pipeline
        // agent may never cancel its own or another request.
        const call = requireRole('cancel', callContext(db, context), ['human'])
        return { content: q.cancelRequest(db, { ...input, actor: call.actor }) }
      },
    },

    {
      name: 'decide',
      description:
        'Open a decision packet. It appears in the inbox until resolved. Silence is never approval.',
      input: {
        type: 'object',
        properties: {
          request: requestRef,
          kind: { type: 'string', enum: ['decision', 'blocked', 'failed', 'done'] },
          question: { type: 'string' },
          recommendation: { type: 'string' },
          evidence: { type: 'string' },
          reversible: { type: 'boolean' },
          cost: { type: 'string' },
          default_if_silent: { type: 'string' },
        },
        required: ['kind', 'question'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('decide', callContext(db, context), ['worker', 'closer', 'human'])
        return { content: q.decide(db, input) }
      },
    },

    {
      name: 'resolve',
      description:
        'Resolve an open decision by id. Pass action "cancel" to close the request instead of retrying it.',
      input: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          resolution: { type: 'string' },
          action: {
            type: 'string',
            enum: ['retry', 'cancel'],
            description:
              'cancel closes the request; retry (the default) only resolves the decision so the daemon may try again.',
          },
        },
        required: ['id', 'resolution'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        const call = requireRole('resolve', callContext(db, context), ['human'])
        return { content: q.resolveDecision(db, { ...input, resolved_by: call.actor }) }
      },
    },

    {
      name: 'tick',
      description:
        'Run the deterministic supervisor rules once: heartbeat, hard budget, attempts, wall clock, soft budget, flat progress. No model calls. Defaults to a dry run.',
      input: {
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true. Pass false to apply.' },
        },
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('tick', callContext(db, context), ['closer', 'human'])
        return { content: q.tick(db, input ?? {}) }
      },
    },
  ]

  if (!guard) return tools
  return tools.map((tool) => ({
    ...tool,
    execute: async (input: any, context: any) => {
      if (!(await guard())) {
        throw new Error(
          'Clara management is disabled. Enable it in the Clara agent panel to use the ledger.'
        )
      }
      return tool.execute(input, context)
    },
  }))
}

/**
 * Record what Clara showed and what the human answered. The alert keeps the
 * last state for history; the request event makes the exchange visible from
 * `clara_ask` without reconstructing a session.
 */
function recordAttention(
  db: Db,
  alert: Row,
  type: 'info' | 'text' | 'opened' | 'answered' | 'cancelled',
  payload: Record<string, unknown>
): void {
  db.prepare('UPDATE alerts SET attention_state = ? WHERE key = ?').run(
    String(payload.state ?? type),
    alert.key
  )
  if (!alert.request_id) return

  try {
    q.appendEvent(db, {
      request: Number(alert.request_id),
      type: `attention.${type}`,
      actor: 'human',
      payload: { alert: alert.key, ...payload },
    })
  } catch {
    // A request can close while the form is open. The alert row is enough then.
  }
}

export default {
  id: 'clara',

  async setup(ctx: any) {
    // The panel owns the master switch and reloads OpenCode when it changes.
    // Do nothing while it is off: no ledger file, no tool catalog entries, and
    // no daemon. The per-tool guard below remains as defence in depth for a
    // setting change that races a reload.
    if (!(await managementEnabled())) {
      console.log('[clara] management disabled; plugin is inert')
      return
    }

    const dbPath: string = ctx.options?.db ?? process.env.CLARA_LEDGER_DB_PATH ?? DEFAULT_DB_PATH
    const db = await getDb(dbPath)
    console.log(`[clara] ledger ready at ${dbPath}`)

    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: NAMESPACE,
        description: 'Clara ledger: submit specs, read state, record events and decisions.',
      })

      for (const tool of createTools(db, managementEnabled, attentionFormApi(ctx))) {
        editor.add({ ...tool, options: { namespace: NAMESPACE } })
      }
    })

    console.log('[clara] management enabled')

    if (daemonDisabled(ctx.options)) {
      console.log('[clara] daemon disabled')
      return
    }
    if (!ctx.session?.create) {
      console.log('[clara] daemon not started: session API unavailable')
      return
    }

    const daemon = createDaemon({
      db,
      ctx,
      management: managementEnabled,
      intervalMs: numberOption(ctx.options?.daemonIntervalMs, 15_000),
      lockStaleMs: numberOption(ctx.options?.daemonLockStaleMs, 300_000),
      maxSpawnsPerTick: numberOption(ctx.options?.daemonMaxSpawnsPerTick, 1),
    })
    daemon.start()
    return () => daemon.stop()
  },
}

function daemonDisabled(options: Record<string, unknown> | undefined): boolean {
  if (options?.daemon === false) return true
  const flag = String(process.env.CLARA_DAEMON ?? '').toLowerCase()
  return flag === '0' || flag === 'false' || flag === 'off'
}

function numberOption(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
