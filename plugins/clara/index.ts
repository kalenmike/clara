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

import { createDaemon } from './daemon.ts'
import { DEFAULT_DB_PATH, getDb, type Db } from './db.ts'
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
 */
export function createTools(db: Db): ClaraTool[] {
  return [
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
        return { content: q.submit(db, input) }
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
      name: 'ask',
      description:
        'Read ledger state. Scope to one feature, one workspace, or all. Returns facts only — never reads session history and never guesses.',
      input: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'What the human asked. Recorded only if unanswerable.',
          },
          feature: featureRef,
          workspace: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['question'],
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
}

export default {
  id: 'clara',

  async setup(ctx: any) {
    const dbPath: string = ctx.options?.db ?? process.env.CLARA_LEDGER_DB_PATH ?? DEFAULT_DB_PATH
    const db = await getDb(dbPath)
    console.log(`[clara] ledger ready at ${dbPath}`)

    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: NAMESPACE,
        description: 'Clara ledger: submit specs, read state, record events and decisions.',
      })

      for (const tool of createTools(db)) {
        editor.add({ ...tool, options: { namespace: NAMESPACE } })
      }
    })

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
