// Clara — self-test. Exercises the ledger end to end against a throwaway DB.
//
//   pnpm --filter @clara/opencode-plugin test
//
// This is not a unit test suite. It is the "does the whole shape hold" check.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as daemon from './daemon.ts'
import { collectAlerts } from './alerts.ts'
import { getDb, managementEnabled } from './db.ts'
import * as q from './queries.ts'
import * as runs from './runs.ts'

let failures = 0
let checks = 0

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function expectThrow(label: string, fn: () => unknown, needle: string): void {
  checks++
  try {
    fn()
    failures++
    console.log(`  FAIL ${label} — expected a throw`)
  } catch (error) {
    const message = (error as Error).message
    if (message.includes(needle)) console.log(`  ok   ${label}`)
    else {
      failures++
      console.log(`  FAIL ${label} — wrong error: ${message}`)
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'clara-selftest-'))
process.env.CLARA_CONFIG_DIR = dir
const dbPath = join(dir, 'ledger.db')
const workspace = join(dir, 'workspace')

// The panel owns the master switch. Give this isolated process a minimal
// home-agent database so the plugin reads a real setting.
const serverDbPath = join(dir, 'clara.db')
const { DatabaseSync } = await import('node:sqlite')
const serverDb = new DatabaseSync(serverDbPath)
serverDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
serverDb
  .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  .run('management.enabled', JSON.stringify(false))

const db = await getDb(dbPath)

console.log('\n0. management setting')
check('management defaults off', (await managementEnabled()) === false)

const offIndex = await import('./index.ts')
const offTools: any[] = []
const offDispose = await offIndex.default.setup({
  options: { db: join(dir, 'off-ledger.db') },
  tool: {
    transform: async (fn: any) =>
      fn({
        namespace: () => undefined,
        add: (tool: any) => offTools.push(tool),
      }),
  },
})
check('disabled setup registers no tools', offTools.length === 0)
check('disabled setup creates no ledger', !existsSync(join(dir, 'off-ledger.db')))
check('disabled setup starts no daemon', offDispose === undefined)

serverDb
  .prepare('UPDATE settings SET value = ? WHERE key = ?')
  .run(JSON.stringify(true), 'management.enabled')
check('management reads the panel setting', (await managementEnabled()) === true)
serverDb.close()

console.log('\n0. plugin registration')
const index = await import('./index.ts')
const plugin = index.default
const registered = new Map<string, any>()
let namespaceName = ''

// Mirror OpenCode 2.2.5's id derivation. `editor.namespace()` only describes a
// group; the tool id is prefixed from `options.namespace`.
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')
const idOf = (tool: any) =>
  tool.options?.namespace === undefined
    ? safeName(tool.name)
    : `${tool.options.namespace.replaceAll('.', '_')}_${safeName(tool.name)}`

await plugin.setup({
  options: { db: dbPath, daemon: false },
  tool: {
    transform: async (fn: any) =>
      fn({
        namespace: (ns: any) => {
          namespaceName = ns.name
        },
        add: (tool: any) => {
          registered.set(idOf(tool), tool)
        },
      }),
  },
})

const expected = [
  'clara_submit',
  'clara_inbox',
  'clara_ask',
  'clara_approve',
  'clara_gate',
  'clara_criteria',
  'clara_freeze',
  'clara_checkpoint',
  'clara_event',
  'clara_decide',
  'clara_resolve',
  'clara_tick',
]
check('plugin id is clara', plugin.id === 'clara')
check('namespace is clara', namespaceName === 'clara')
check('registers 12 tools', registered.size === 12, `got ${[...registered.keys()].join(', ')}`)
for (const name of expected) check(`tool ${name}`, registered.has(name))
check(
  'every tool carries the clara namespace',
  [...registered.values()].every((t) => t.options?.namespace === 'clara')
)
check(
  'no tool is registered under its bare name',
  ![...registered.keys()].some((id) => !id.startsWith('clara_'))
)

const agents = JSON.parse(readFileSync(new URL('./agents.json', import.meta.url), 'utf8'))
const allowed = new Set<string>()
for (const definition of Object.values(agents.agents) as any[]) {
  for (const permission of definition.permissions ?? []) {
    if (
      permission.effect === 'allow' &&
      permission.action.startsWith('clara_') &&
      !permission.action.includes('*')
    ) {
      allowed.add(permission.action)
    }
  }
}
check(
  'every explicit agent permission names a registered tool',
  [...allowed].every((name) => registered.has(name)),
  [...allowed].filter((name) => !registered.has(name)).join(', ')
)
check(
  'every tool is allowed for at least one agent',
  [...registered.keys()].every((id) => allowed.has(id)),
  [...registered.keys()].filter((id) => !allowed.has(id)).join(', ')
)

const buildPermissions = ((agents.agents as any)['003'].permissions ?? []) as any[]
check(
  'build agent can run pnpm',
  buildPermissions.some(
    (p) => p.action === 'shell' && p.resource === 'pnpm *' && p.effect === 'allow'
  )
)
check(
  'build agent can edit app sources',
  buildPermissions.some(
    (p) => p.action === 'edit' && p.resource === 'apps/**/src/**' && p.effect === 'allow'
  )
)
check(
  'build agent cannot edit tests',
  buildPermissions.some(
    (p) => p.action === 'edit' && p.resource === '**/*.test.*' && p.effect === 'deny'
  )
)
check(
  'build agent can append its record',
  buildPermissions.some(
    (p) => p.action === 'edit' && p.resource === 'docs/records/**' && p.effect === 'allow'
  )
)
const docsPermissions = ((agents.agents as any)['004'].permissions ?? []) as any[]
check(
  'docs agent can open a decision',
  docsPermissions.some((p) => p.action === 'clara_decide' && p.effect === 'allow')
)
check(
  'docs agent can edit canonical docs',
  docsPermissions.some(
    (p) => p.action === 'edit' && p.resource === 'docs/**' && p.effect === 'allow'
  )
)
check(
  'docs agent cannot edit generated records',
  docsPermissions.some(
    (p) => p.action === 'edit' && p.resource === 'docs/records/**' && p.effect === 'deny'
  )
)
check(
  'docs agent cannot bypass edits with shell',
  docsPermissions.some((p) => p.action === 'shell' && p.resource === '*' && p.effect === 'deny')
)
const specPermissions = ((agents.agents as any)['001'].permissions ?? []) as any[]
check(
  'spec agent can append its record',
  specPermissions.some(
    (p) => p.action === 'edit' && p.resource === 'docs/records/**' && p.effect === 'allow'
  )
)
check('docs agent maps to ai_4', index.AGENT_ACTORS['004'] === 'ai_4')

check(
  'every tool has a description',
  [...registered.values()].every((t) => !!t.description)
)
check(
  'every tool has an input schema',
  [...registered.values()].every((t) => !!t.input)
)
check(
  'every tool has execute',
  [...registered.values()].every((t) => typeof t.execute === 'function')
)

const controlDb = new DatabaseSync(serverDbPath)
controlDb
  .prepare('UPDATE settings SET value = ? WHERE key = ?')
  .run(JSON.stringify(false), 'management.enabled')
let guarded = false
try {
  await registered.get('clara_inbox')!.execute({})
} catch (error) {
  guarded = (error as Error).message.includes('Clara management is disabled')
}
check('tools refuse while management is off', guarded)
controlDb
  .prepare('UPDATE settings SET value = ? WHERE key = ?')
  .run(JSON.stringify(true), 'management.enabled')
controlDb.close()

const wired = await registered.get('clara_inbox')!.execute({})
check('tool execute reaches the ledger', String(wired.content).startsWith('inbox: empty'))

console.log('\n1. submit')
const submitted = q.submit(db, {
  workspace: 'clara',
  path: workspace,
  title: 'Users can log in remotely with a uniquely generated key sent by email',
  intent: 'A user can authenticate from a new device by requesting a key by email.',
  why: 'Password resets are the top support ticket.',
  non_goals: ['password login', 'remember this device', 'SMS delivery'],
  constraints: ['must reuse the existing mailer'],
  not_worth_it: 'if remote login needs a migration on the users table',
  soft_budget: 600_000,
  hard_budget: 1_200_000,
})
console.log(submitted)
const feature = db.prepare('SELECT * FROM features ORDER BY id DESC LIMIT 1').get()!
check('feature exists', !!feature)
check('state is spec', feature.state === 'spec')
check('record written', existsSync(String(feature.spec_path)))
check(
  'record lives under docs/records',
  String(feature.spec_path).includes('/docs/records/'),
  String(feature.spec_path)
)
check(
  'event recorded',
  db.prepare('SELECT COUNT(*) c FROM events WHERE feature_id = ?').get(feature.id)!.c === 1
)

const sessionDir = join(dir, 'session-workspace')
mkdirSync(sessionDir, { recursive: true })
const sessionDb = await getDb(join(dir, 'session-ledger.db'))
const sessionSubmit = index
  .createTools(sessionDb)
  .find((tool) => tool.name === 'submit')!
await sessionSubmit.execute(
  {
    workspace: 'session',
    path: sessionDir,
    title: 'A submit remembers the Clara session',
    intent: 'Later alerts return to the conversation where the human asked.',
  },
  { agent: 'clara', sessionID: 'ses_origin' }
)
const sessionFeature = sessionDb.prepare('SELECT * FROM features ORDER BY id DESC LIMIT 1').get()!
const sessionWorkspace = sessionDb
  .prepare('SELECT * FROM workspaces WHERE name = ?')
  .get('session')!
check('submit records the originating session', sessionFeature.session_id === 'ses_origin')
check('submit records the workspace session', sessionWorkspace.session_id === 'ses_origin')
check(
  'registered event names the session',
  JSON.parse(
    String(
      sessionDb.prepare('SELECT payload FROM events WHERE feature_id = ?').get(sessionFeature.id)!
        .payload
    )
  ).session === 'ses_origin'
)
sessionDb.close()

console.log('\n2. criteria')
expectThrow(
  'rejects a criterion with no test and no human gate',
  () => q.setCriteria(db, { feature: feature.id, criteria: [{ text: 'it feels right' }] }),
  'neither a test_path nor human_gate'
)

q.setCriteria(db, {
  feature: feature.id,
  criteria: [
    {
      text: 'requesting a key for a known email sends exactly one email',
      test_path: 'tests/auth/request.test.ts',
    },
    {
      text: 'a key authenticates once; second use is rejected',
      test_path: 'tests/auth/single-use.test.ts',
    },
    { text: 'a key expires after 15 minutes', test_path: 'tests/auth/expiry.test.ts' },
    { text: 'the email copy is acceptable to send to customers', human_gate: true },
  ],
  kill_criteria: [
    'if remote login requires a migration on the users table, stop and report',
    'if the mailer is unreachable from tests, stop — do not mock the auth path',
  ],
})
const criteria = db.prepare('SELECT * FROM criteria WHERE feature_id = ?').all(feature.id)
check('four criteria stored', criteria.length === 4)
check('one human gate', criteria.filter((c: any) => c.human_gate).length === 1)
check(
  'none approved yet',
  criteria.every((c: any) => !c.approved_at)
)

console.log('\n3. approval gate')
let blocked = ''
try {
  await registered.get('clara_approve')!.execute({ feature: feature.id }, { agent: '003' })
} catch (error) {
  blocked = (error as Error).message
}
check('implementer cannot approve criteria', blocked.includes('not available to 003'), blocked)

q.approve(db, { feature: feature.id })
const afterApprove = q.featureByRef(db, feature.id)!
check('state is planned', afterApprove.state === 'planned')
check(
  'criteria approved',
  db
    .prepare('SELECT * FROM criteria WHERE feature_id = ?')
    .all(feature.id)
    .every((c: any) => c.approved_at)
)

console.log('\n4. freeze + build')
expectThrow(
  'cannot checkpoint before building',
  () => q.checkpoint(db, { feature: feature.id, tests_passed: 1, tests_total: 4 }),
  'state=building'
)

q.freeze(db, { feature: feature.id, tests_hash: '8f3ac21d', tests_total: 4 })
q.appendEvent(db, { feature: feature.id, type: 'build.started', actor: 'ai_3', state: 'building' })
check('state is building', q.featureByRef(db, feature.id)!.state === 'building')

q.checkpoint(db, {
  feature: feature.id,
  tests_passed: 1,
  tests_total: 4,
  files_changed: 3,
  criteria_addressed: [1],
  next: 'add injectable clock',
  tokens: 40_000,
})
q.checkpoint(db, {
  feature: feature.id,
  tests_passed: 1,
  tests_total: 4,
  files_changed: 5,
  blocked_on: 'clock abstraction missing from the harness',
  tokens: 55_000,
})
const cps = db.prepare('SELECT * FROM checkpoints WHERE feature_id = ? ORDER BY n').all(feature.id)
check('two checkpoints', cps.length === 2)
check('tokens accumulated', q.featureByRef(db, feature.id)!.tokens === 95_000)

console.log('\n5. inbox')
check('inbox empty when nothing needs a human', q.inbox(db).startsWith('inbox: empty'))

const decisionId = Number(
  q
    .decide(db, {
      feature: feature.id,
      kind: 'decision',
      question: 'The clock abstraction is missing. Add it, or drop the expiry criterion?',
      recommendation: 'add an injectable clock — dropping expiry is a security regression',
      evidence: '2 checkpoints, tests stuck at 1/4',
      reversible: true,
      cost: '~80k tokens',
      default_if_silent: 'block',
    })
    .match(/#(\d+)/)![1]
)

const inbox = q.inbox(db)
check('inbox shows the decision', inbox.includes('clock abstraction'))
check('inbox shows the default', inbox.includes('default if silent: block'))

console.log('\n6. ask')
const asked = q.ask(db, { question: 'what is 001 doing?', feature: feature.id })
check('ask reports state', asked.includes('state:     building'))
check('ask reports criteria', asked.includes('4/4 approved'))
check('ask reports checkpoints', asked.includes('checkpoint'))
check('ask reports criteria covered by a checkpoint', asked.includes('criteria 1'))
check('ask reports the frozen test hash', asked.includes('tests:     8f3ac21d (4 tests)'))
check('ask reports docs state', asked.includes('docs:      none'))
check('ask reports unverified human gates', asked.includes('human:     UNVERIFIED (4)'))
check('ask reports the current blocker', asked.includes('blocked:   clock abstraction'))
check('ask marks the record frontmatter historical', asked.includes('frontmatter is historical'))
check(
  'ask works without a question when scoped to a feature',
  q.ask(db, { feature: feature.id }).includes('state:     building')
)
const askTool = await registered
  .get('clara_ask')!
  .execute({ feature: feature.id }, { agent: 'clara' })
check(
  'ask tool accepts a feature without a question',
  String(askTool.content).includes('state:     building')
)

const missing = q.ask(db, {
  question: 'what did we decide about billing?',
  feature: 'does-not-exist',
})
check('unanswerable question records a gap', missing.includes('Gap recorded'))
check('gap persisted', db.prepare('SELECT COUNT(*) c FROM schema_gaps').get()!.c === 1)

console.log('\n7. state machine')
expectThrow(
  'building cannot jump to done',
  () => q.appendEvent(db, { feature: feature.id, type: 'x', actor: 'ai_0', state: 'done' }),
  'illegal transition'
)

q.appendEvent(db, { feature: feature.id, type: 'close.requested', actor: 'ai_3', state: 'review' })
check('state is review', q.featureByRef(db, feature.id)!.state === 'review')
check('review clears the stale blocker', !q.featureByRef(db, feature.id)!.blocked_on)
check(
  'ask no longer shows the blocked header',
  !q.ask(db, { feature: feature.id }).includes('blocked:   clock abstraction')
)

let gateRole = ''
try {
  await registered.get('clara_gate')!.execute({ feature: feature.id }, { agent: 'judge' })
} catch (error) {
  gateRole = (error as Error).message
}
check('judge cannot record a human gate', gateRole.includes('not available to judge'), gateRole)

expectThrow(
  'only human-gate criteria can be confirmed',
  () => q.gate(db, { feature: feature.id, criteria: [1] }),
  'not human gates'
)

const gated = await registered
  .get('clara_gate')!
  .execute({ feature: feature.id, evidence: 'email copy reviewed' }, { agent: 'clara' })
check(
  'human records the gate through the tool',
  String(gated.content).includes('human gates verified — 4'),
  String(gated.content)
)
const afterGate = q.ask(db, { feature: feature.id })
check('ask shows the gate verified', afterGate.includes('human:     verified 4'))
check('recent events explain the gate', afterGate.includes('human.gates (4 verified)'))

q.gate(db, { feature: feature.id, criteria: [4], result: 'rejected' })
check('a rejection reopens the gate', q.ask(db, { feature: feature.id }).includes('UNVERIFIED (4)'))
q.gate(db, { feature: feature.id, criteria: [4] })
check(
  'a later verification wins',
  q.ask(db, { feature: feature.id }).includes('human:     verified 4')
)

expectThrow(
  'ai_3 cannot close a feature',
  () =>
    q.appendEvent(db, {
      feature: feature.id,
      type: 'close.confirmed',
      actor: 'ai_3',
      state: 'done',
    }),
  'only ai_0'
)

let spoofed = ''
try {
  await registered
    .get('clara_event')!
    .execute(
      { feature: feature.id, type: 'close.confirmed', actor: 'ai_0', state: 'done' },
      { agent: '003' }
    )
} catch (error) {
  spoofed = (error as Error).message
}
check('implementer cannot spoof actor=ai_0', spoofed.includes('only ai_0'), spoofed)

const confirmed = await registered
  .get('clara_event')!
  .execute({ feature: feature.id, type: 'close.confirmed', state: 'done' }, { agent: 'judge' })
check('ai_0 confirms close through the tool', String(confirmed.content).includes('state=done'))
const done = q.featureByRef(db, feature.id)!
check('state is done', done.state === 'done')
check('closed_at set', !!done.closed_at)

console.log('\n8. resolve')
q.resolveDecision(db, { id: decisionId, resolution: 'add the clock' })
check(
  'decision resolved',
  !!db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId)!.resolved_at
)
check('inbox empty again', q.inbox(db).startsWith('inbox: empty'))

console.log('\n9. tick')
const stalled = q.submit(db, {
  workspace: 'clara',
  title: 'Export a CSV',
  intent: 'A user can export their data as CSV.',
  soft_budget: 1000,
  hard_budget: 5000,
})
const stalledId = Number(stalled.match(/registered (\d+)/)![1])
q.setCriteria(db, {
  feature: stalledId,
  criteria: [{ text: 'export works', test_path: 'tests/export.test.ts' }],
})
q.approve(db, { feature: stalledId })
q.freeze(db, { feature: stalledId, tests_hash: 'abc123', tests_total: 1 })
q.appendEvent(db, { feature: stalledId, type: 'build.started', actor: 'ai_3', state: 'building' })
db.prepare('UPDATE features SET tokens = 6000, last_event_at = ? WHERE id = ?').run(
  new Date(Date.now() - 30 * 60_000).toISOString(),
  stalledId
)

const dry = q.tick(db, { dry_run: true })
check('tick dry run reports but does not act', dry.includes('WOULD'))
check('dry run did not kill', q.featureByRef(db, stalledId)!.state === 'building')

const live = q.tick(db, { dry_run: false })
check('tick kills over hard budget', q.featureByRef(db, stalledId)!.state === 'scrapped')
check('scrap reason recorded', q.featureByRef(db, stalledId)!.scrap_reason === 'budget')
check('tick output mentions the kill', live.includes('killed'))

console.log('\n10. record file')
const record = await import('node:fs').then((fs) =>
  fs.readFileSync(String(q.featureByRef(db, feature.id)!.spec_path), 'utf8')
)
check('record has front matter', record.startsWith('---'))
check('record has non-goals', record.includes('password login'))
check('record has criteria table', record.includes('| # | Criterion | Test | Human gate |'))
check('record has checkpoints', record.includes('**#2**'))

console.log('\n11. daemon')
type MockSession = {
  id: string
  agent: string
  title: string
  prompt: string
  model?: string
  metadata?: Record<string, unknown>
  promptMetadata?: Record<string, unknown>
  outcome?: 'succeeded' | 'failed' | 'interrupted'
}

const daemonDir = join(dir, 'daemon')
const daemonWorkspace = join(daemonDir, 'workspace')
const daemonDbPath = join(daemonDir, 'ledger.db')
mkdirSync(daemonWorkspace, { recursive: true })
const ddb = await getDb(daemonDbPath)
const sessions: MockSession[] = []

const sessionApi = {
  async create(input: {
    title?: string
    model?: { providerID: string; id: string; variant?: string }
    metadata?: Record<string, unknown>
  }) {
    const session: MockSession = {
      id: `ses_daemon_${sessions.length + 1}`,
      agent: '',
      title: input.title ?? '',
      prompt: '',
      model: input.model ? `${input.model.providerID}/${input.model.id}` : undefined,
      metadata: input.metadata,
    }
    sessions.push(session)
    return { id: session.id }
  },
  async switchAgent(input: { sessionID: string; agent: string }) {
    const session = sessions.find((item) => item.id === input.sessionID)
    if (!session) throw new Error(`no session ${input.sessionID}`)
    session.agent = input.agent
  },
  async prompt(input: { sessionID: string; text: string; metadata?: Record<string, unknown> }) {
    const session = sessions.find((item) => item.id === input.sessionID)
    if (!session) throw new Error(`no session ${input.sessionID}`)
    session.prompt = input.text
    session.promptMetadata = input.metadata
  },
  async get(input: { sessionID: string }) {
    const session = sessions.find((item) => item.id === input.sessionID)
    if (!session) throw new Error(`no session ${input.sessionID}`)
    return { id: session.id, outcome: session.outcome }
  },
  async interrupt(input: { sessionID: string }) {
    const session = sessions.find((item) => item.id === input.sessionID)
    if (session) session.outcome = 'interrupted'
  },
}

const silent = { info: () => {}, error: () => {} }
const supervisor = daemon.createDaemon({
  db: ddb,
  ctx: { session: sessionApi, options: { daemonModel: 'test/model' } },
  intervalMs: 60_000,
  lockStaleMs: 60_000,
  logger: silent,
})

const daemonSubmit = q.submit(ddb, {
  workspace: 'daemon',
  path: daemonWorkspace,
  title: 'The daemon drives a feature',
  intent: 'A feature reaches done without a human launching each stage.',
})
const daemonId = Number(daemonSubmit.match(/registered (\d+)/)![1])

await supervisor.runOnce()
check(
  'daemon starts the spec stage',
  sessions.length === 1 && sessions[0].agent === '001',
  JSON.stringify(sessions.map((s) => s.agent))
)
check(
  'daemon records a running spec run',
  runs.latestRun(ddb, daemonId, 'spec')?.status === 'running'
)
check('daemon passes a model to the worker', sessions[0].model === 'test/model')
check(
  'daemon marks the worker session as automation',
  sessions[0].metadata?.initiatedBy === 'daemon' && sessions[0].metadata?.automation === true,
  JSON.stringify(sessions[0].metadata)
)
check(
  'daemon marks the handoff prompt as synthetic',
  sessions[0].promptMetadata?.source === 'daemon' && sessions[0].promptMetadata?.synthetic === true,
  JSON.stringify(sessions[0].promptMetadata)
)
check('handoff prompt names the stage', sessions[0].prompt.includes('acceptance criteria'))

q.setCriteria(ddb, {
  feature: daemonId,
  criteria: [{ text: 'the daemon drives the feature', test_path: 'tests/daemon.test.ts' }],
  docs_impact: 'update docs/features/daemon.md',
})
check(
  'criteria records the docs impact',
  q.featureByRef(ddb, daemonId)!.docs_impact === 'update docs/features/daemon.md'
)
sessions[0].outcome = 'succeeded'
await supervisor.runOnce()
check('spec run is done', runs.latestRun(ddb, daemonId, 'spec')?.status === 'done')
check('daemon waits for approval', sessions.length === 1)

q.approve(ddb, { feature: daemonId })
await supervisor.runOnce()
check(
  'daemon starts the test stage after approval',
  sessions.length === 2 && sessions[1].agent === '002'
)
check(
  'later stages keep the automation metadata',
  sessions[1].metadata?.automation === true && sessions[1].promptMetadata?.synthetic === true,
  JSON.stringify({ session: sessions[1].metadata, prompt: sessions[1].promptMetadata })
)

q.freeze(ddb, { feature: daemonId, tests_hash: 'daemon-hash', tests_total: 1 })
sessions[1].outcome = 'succeeded'
await supervisor.runOnce()
check('test run is done', runs.latestRun(ddb, daemonId, 'test')?.status === 'done')
check('daemon starts the build stage', sessions.length === 3 && sessions[2].agent === '003')
check('daemon moved the feature to building', q.featureByRef(ddb, daemonId)!.state === 'building')

q.checkpoint(ddb, {
  feature: daemonId,
  tests_passed: 1,
  tests_total: 1,
  files_changed: 2,
  docs_impact: 'update docs/features/ledger.md',
})
check(
  'checkpoint refines the docs impact',
  q.featureByRef(ddb, daemonId)!.docs_impact === 'update docs/features/ledger.md'
)
const daemonAsk = q.ask(ddb, { feature: daemonId })
check(
  'ask reports the docs impact as pending',
  daemonAsk.includes('docs:      pending (update docs/features/ledger.md)')
)
check(
  'ask lists the live run with its session',
  daemonAsk.includes('build running (003 ses_daemon_3')
)
check('ask reports no human gates for this feature', daemonAsk.includes('human:     no gates'))

q.appendEvent(ddb, {
  feature: daemonId,
  type: 'build.review',
  actor: 'ai_3',
  state: 'review',
})
sessions[2].outcome = 'succeeded'
await supervisor.runOnce()
check('build run is done', runs.latestRun(ddb, daemonId, 'build')?.status === 'done')
check('daemon starts the docs stage', sessions.length === 4 && sessions[3].agent === '004')

sessions[3].outcome = 'succeeded'
await supervisor.runOnce()
check('docs run is done', runs.latestRun(ddb, daemonId, 'docs')?.status === 'done')
check(
  'ask reports the docs impact as applied',
  q.ask(ddb, { feature: daemonId }).includes('docs:      applied (update docs/features/ledger.md)')
)
check('daemon starts the judge stage', sessions.length === 5 && sessions[4].agent === 'judge')
check(
  'judge handoff points at the ledger and the gates',
  sessions[4].prompt.includes('clara_ask') && sessions[4].prompt.includes('human gates')
)

q.appendEvent(ddb, {
  feature: daemonId,
  type: 'feature.done',
  actor: 'ai_0',
  state: 'done',
})
sessions[4].outcome = 'succeeded'
await supervisor.runOnce()
check('judge run is done', runs.latestRun(ddb, daemonId, 'judge')?.status === 'done')
check('daemon does not spawn after done', sessions.length === 5)
check('feature is done', q.featureByRef(ddb, daemonId)!.state === 'done')

const failedSubmit = q.submit(ddb, {
  workspace: 'daemon',
  path: daemonWorkspace,
  title: 'The daemon handles a failed stage',
  intent: 'A failed stage asks the human instead of retrying blindly.',
})
const failedId = Number(failedSubmit.match(/registered (\d+)/)![1])
await supervisor.runOnce()
const failedSession = sessions[sessions.length - 1]
check(
  'failed feature starts a spec session',
  failedSession.agent === '001',
  JSON.stringify(sessions.map((s) => `${s.id}:${s.agent}`))
)
failedSession.outcome = 'failed'
await supervisor.runOnce()
check('failed run is recorded', runs.latestRun(ddb, failedId, 'spec')?.status === 'failed')
const open = ddb
  .prepare('SELECT * FROM decisions WHERE feature_id = ? AND resolved_at IS NULL')
  .get(failedId)
check('failed run opens a decision', Boolean(open))
check('failed run does not spawn again', sessions.length === 6)

q.resolveDecision(ddb, { id: Number(open!.id), resolution: 'retry' })
await supervisor.runOnce()
check('resolved decision retries the stage', sessions.length === 7 && sessions[6].agent === '001')

supervisor.stop()
check('daemon releases its lock', !ddb.prepare('SELECT 1 FROM daemon_lock WHERE id = 1').get())

check('daemon lock is exclusive', runs.acquireDaemonLock(ddb, 'selftest-a', 1, 60_000))
check(
  'a second owner is refused while the lock is fresh',
  !runs.acquireDaemonLock(ddb, 'selftest-b', 2, 60_000)
)
ddb
  .prepare('UPDATE daemon_lock SET heartbeat_at = ? WHERE id = 1')
  .run(new Date(Date.now() - 120_000).toISOString())
check('a stale lock can be taken over', runs.acquireDaemonLock(ddb, 'selftest-b', 2, 60_000))
runs.releaseDaemonLock(ddb, 'selftest-b')
check('lock row is gone', !ddb.prepare('SELECT 1 FROM daemon_lock WHERE id = 1').get())

console.log('\n14. alert outbox')
const waitSubmit = q.submit(db, {
  workspace: 'clara',
  path: workspace,
  title: 'Wait states produce alerts',
  intent: 'The outbox names approval and gate waits as well as decisions.',
})
const waitId = Number(waitSubmit.match(/registered (\d+)/)![1])
q.setCriteria(db, {
  feature: waitId,
  criteria: [{ text: 'a human verifies the wait state', human_gate: true }],
  docs_impact: 'none',
})
collectAlerts(db)
const approvalAlert = db
  .prepare('SELECT * FROM alerts WHERE key = ? AND resolved_at IS NULL')
  .get(`approval:${waitId}`)
check('criteria approval creates an alert', Boolean(approvalAlert))

q.approve(db, { feature: waitId })
collectAlerts(db)
const approvalClosed = db
  .prepare('SELECT resolved_at FROM alerts WHERE key = ?')
  .get(`approval:${waitId}`)
check('approval resolves the alert', Boolean(approvalClosed?.resolved_at))

q.freeze(db, { feature: waitId, tests_hash: 'sha256:wait', tests_total: 1 })
q.appendEvent(db, { feature: waitId, type: 'build.started', actor: 'ai_0', state: 'building' })
q.appendEvent(db, { feature: waitId, type: 'build.review', actor: 'ai_0', state: 'review' })
collectAlerts(db)
const gateAlert = db
  .prepare('SELECT * FROM alerts WHERE key = ? AND resolved_at IS NULL')
  .get(`gates:${waitId}`)
check('review gates create an alert', Boolean(gateAlert))

q.gate(db, { feature: waitId, criteria: [1] })
collectAlerts(db)
const gateClosed = db.prepare('SELECT resolved_at FROM alerts WHERE key = ?').get(`gates:${waitId}`)
check('gate verification resolves the alert', Boolean(gateClosed?.resolved_at))

const decisionAlert = q.decide(db, {
  feature: waitId,
  kind: 'decision',
  question: 'Should this wait state be tested?',
})
collectAlerts(db)
const openDecision = db
  .prepare("SELECT * FROM alerts WHERE key LIKE 'decision:%' AND resolved_at IS NULL")
  .get()
check('an open decision creates an alert', Boolean(openDecision), decisionAlert)

rmSync(dir, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.error(`${failures} failed`)
  process.exit(1)
}
