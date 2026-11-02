// Clara — OpenCode plugin.
//
// Registers the ledger tools. Nothing here is an agent: agents call these
// tools, the tools read and write the ledger, and the ledger is the only
// thing that crosses an agent boundary.
//
// OpenCode discovers this plugin from the global plugin directory after
// `pnpm clara:plugin:install`:
//
//   ~/.config/opencode/plugins/clara -> <repo>/plugins/clara
//
// The ledger lives at ${CLARA_CONFIG_DIR:-~/.config/clara}/ledger.db.
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

const featureRef = {
  anyOf: [{ type: 'string' }, { type: 'number' }],
  description: 'Feature id (e.g. 42) or slug (e.g. remote-key-login)',
}

// Who is acting is decided by the agent that invoked the tool, never by the
// arguments. Otherwise ai_3 could pass actor="ai_0" and close its own work.
export const AGENT_ACTORS: Record<string, string> = {
  '001': 'ai_1',
  '002': 'ai_2',
  '003': 'ai_3',
  '004': 'ai_4',
  judge: 'ai_0',
  clara: 'human',
}

const actorOf = (context: any): string => AGENT_ACTORS[String(context?.agent ?? '')] ?? 'human'

function requireRole(name: string, context: any, allowed: string[]): string {
  const actor = actorOf(context)
  if (!allowed.includes(actor)) {
    throw new Error(
      `Clara: ${name} is not available to ${context?.agent ?? 'unknown'} (actor ${actor}); ` +
        `allowed: ${allowed.join(', ')}`
    )
  }
  return actor
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
  const tools: ClaraTool[] = [
    // -- human facing ------------------------------------------------------

    {
      name: 'submit',
      description:
        'Register a feature spec. Creates the ledger row, the state=spec record in the workspace, and the first event. Nothing is built until criteria are approved.',
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
            description: 'The condition under which this feature should be abandoned',
          },
          soft_budget: { type: 'number', description: 'Tokens. Above this, Clara must ask.' },
          hard_budget: { type: 'number', description: 'Tokens. Above this, Clara kills.' },
          time_limit_minutes: { type: 'number' },
        },
        required: ['workspace', 'title', 'intent'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('submit', context, ['human'])
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
        'List everything that needs a human: open decisions, stalled features, features over soft budget. Silent when nothing needs you.',
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
        requireRole('attention', context, ['human'])
        const alert = db.prepare('SELECT * FROM alerts WHERE key = ?').get(String(input.alert)) as
          Row | undefined
        if (!alert) return { content: `Clara: no alert "${input.alert}".` }

        const state = String(input.state)
        if (!ATTENTION_STATES.includes(state as (typeof ATTENTION_STATES)[number])) {
          throw new Error(`Clara: attention state must be one of ${ATTENTION_STATES.join(', ')}`)
        }

        const oneTime = String(alert.key).startsWith('kill:')
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
        'Read ledger state. Scope to one feature, one workspace, or all. Returns facts only — never reads session history and never guesses.',
      input: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'What the human asked. Optional when scoped to a feature; recorded only if unanswerable.',
          },
          feature: featureRef,
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
        "Human approval of the proposed acceptance criteria. Moves the feature from spec to planned. Never call this on the human's behalf.",
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
          approved_by: { type: 'string' },
        },
        required: ['feature'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('approve', context, ['human'])
        return { content: q.approve(db, input) }
      },
    },

    {
      name: 'gate',
      description:
        'Record that a human verified the human-gate criteria of a feature in review. The judge closes only when every gate is recorded.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
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
        required: ['feature'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('gate', context, ['human'])
        return { content: q.gate(db, input) }
      },
    },

    // -- spec agent (ai_1) -------------------------------------------------

    {
      name: 'criteria',
      description:
        'Propose the acceptance criteria. Every criterion needs either a test_path or human_gate=true. Replaces any previous proposal.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                test_path: { type: 'string' },
                human_gate: { type: 'boolean' },
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
        required: ['feature', 'criteria'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('criteria', context, ['ai_1', 'human'])
        return { content: q.setCriteria(db, input) }
      },
    },

    // -- test agent (ai_2) -------------------------------------------------

    {
      name: 'freeze',
      description:
        'Record the hash of the finished test suite. After this the tests may not change; the close gate compares against this hash.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
          tests_hash: { type: 'string' },
          tests_total: { type: 'number' },
        },
        required: ['feature', 'tests_hash'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('freeze', context, ['ai_2', 'human'])
        return { content: q.freeze(db, input) }
      },
    },

    // -- build agent (ai_3) ------------------------------------------------

    {
      name: 'checkpoint',
      description:
        'Report progress at a checkpoint boundary. Numbers must come from CI and git, not from self-assessment.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
          tests_passed: { type: 'number' },
          tests_total: { type: 'number' },
          files_changed: { type: 'number' },
          criteria_addressed: { type: 'array', items: { type: 'number' } },
          blocked_on: { type: 'string' },
          next: { type: 'string' },
          open_question: { type: 'string' },
          tokens: { type: 'number' },
          docs_impact: {
            type: 'string',
            description: 'Workspace docs that must change, or "none".',
          },
        },
        required: ['feature', 'tests_passed', 'tests_total'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('checkpoint', context, ['ai_3', 'human'])
        return { content: q.checkpoint(db, input) }
      },
    },

    // -- supervisor (ai_0) -------------------------------------------------

    {
      name: 'event',
      description:
        'Append an event and optionally transition state. Legal transitions only. Only ai_0 may move a feature to done or scrapped.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
          type: { type: 'string' },
          payload: { type: 'object' },
          state: {
            type: 'string',
            enum: ['spec', 'planned', 'building', 'review', 'done', 'scrapped'],
          },
        },
        required: ['feature', 'type'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => ({
        content: q.appendEvent(db, { ...input, actor: actorOf(context) }),
      }),
    },

    {
      name: 'decide',
      description:
        'Open a decision packet. It appears in the inbox until resolved. Silence is never approval.',
      input: {
        type: 'object',
        properties: {
          feature: featureRef,
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
        requireRole('decide', context, ['ai_0', 'ai_4', 'human'])
        return { content: q.decide(db, input) }
      },
    },

    {
      name: 'resolve',
      description: 'Resolve an open decision by id.',
      input: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          resolution: { type: 'string' },
          resolved_by: { type: 'string' },
        },
        required: ['id', 'resolution'],
        additionalProperties: false,
      },
      execute: async (input: any, context: any) => {
        requireRole('resolve', context, ['human'])
        return { content: q.resolveDecision(db, input) }
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
        requireRole('tick', context, ['ai_0', 'human'])
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
 * last state for history; the feature event makes the exchange visible from
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
  if (!alert.feature_id) return

  try {
    q.appendEvent(db, {
      feature: Number(alert.feature_id),
      type: `attention.${type}`,
      actor: 'human',
      payload: { alert: alert.key, ...payload },
    })
  } catch {
    // A feature can close while the form is open. The alert row is enough then.
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
