// Clara — self-test. Exercises the ledger end to end against a throwaway DB.
//
//   pnpm --filter @clara/opencode-plugin test
//
// This is not a unit test suite. It is the "does the whole shape hold" check.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as daemon from './daemon.ts'
import { collectAlerts } from './alerts.ts'
import { deliverAttention } from './attention.ts'
import { getDb, managementEnabled } from './db.ts'
import * as q from './queries.ts'
import * as runs from './runs.ts'
import {
  CONTENT_PIPELINE,
  SOFTWARE_PIPELINE,
  catalogPipelines,
  evaluateCondition,
  loadPipeline,
  pipelineForRequest,
  pipelineHash,
  selectWorkspacePipeline,
  validatePipeline,
} from './pipeline.ts'

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
const tools = new Map<string, any>()
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
          tools.set(idOf(tool), tool)
        },
      }),
  },
})

const expected = [
  'clara_submit',
  'clara_attention',
  'clara_inbox',
  'clara_ask',
  'clara_approve',
  'clara_gate',
  'clara_criteria',
  'clara_stage_done',
  'clara_stage_gate',
  'clara_progress',
  'clara_event',
  'clara_decide',
  'clara_resolve',
  'clara_tick',
]
check('plugin id is clara', plugin.id === 'clara')
check('namespace is clara', namespaceName === 'clara')
check('registers 14 tools', tools.size === 14, `got ${[...tools.keys()].join(', ')}`)
for (const name of expected) check(`tool ${name}`, tools.has(name))
check(
  'every tool carries the clara namespace',
  [...tools.values()].every((t) => t.options?.namespace === 'clara')
)
check(
  'no tool is reachable under its bare name',
  ![...tools.keys()].some((id) => !id.startsWith('clara_'))
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
  [...allowed].every((name) => tools.has(name)),
  [...allowed].filter((name) => !tools.has(name)).join(', ')
)
check(
  'every tool is allowed for at least one agent',
  [...tools.keys()].every((id) => allowed.has(id)),
  [...tools.keys()].filter((id) => !allowed.has(id)).join(', ')
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
check('docs agent maps to the worker role', index.ROLE_FOR_AGENT['004'] === 'worker')
check(
  'content agents map to the worker role',
  ['clara-brief', 'clara-writer', 'clara-editor'].every(
    (agent) => index.ROLE_FOR_AGENT[agent] === 'worker'
  )
)
check('the shared closer maps to the closer role', index.ROLE_FOR_AGENT['judge'] === 'closer')

check(
  'every tool has a description',
  [...tools.values()].every((t) => !!t.description)
)
check(
  'every tool has an input schema',
  [...tools.values()].every((t) => !!t.input)
)
check(
  'every tool has execute',
  [...tools.values()].every((t) => typeof t.execute === 'function')
)

const controlDb = new DatabaseSync(serverDbPath)
controlDb
  .prepare('UPDATE settings SET value = ? WHERE key = ?')
  .run(JSON.stringify(false), 'management.enabled')
let guarded = false
try {
  await tools.get('clara_inbox')!.execute({})
} catch (error) {
  guarded = (error as Error).message.includes('Clara management is disabled')
}
check('tools refuse while management is off', guarded)
controlDb
  .prepare('UPDATE settings SET value = ? WHERE key = ?')
  .run(JSON.stringify(true), 'management.enabled')
controlDb.close()

const wired = await tools.get('clara_inbox')!.execute({})
check('tool execute reaches the ledger', String(wired.content).startsWith('inbox: empty'))

console.log('\n0b. pipelines')
check(
  'built-in software pipeline validates',
  validatePipeline(SOFTWARE_PIPELINE).errors.length === 0
)
check('content example validates', validatePipeline(CONTENT_PIPELINE).errors.length === 0)
const builtinCatalog = catalogPipelines(join(dir, 'no-pipelines'))
const builtinIds = builtinCatalog.pipelines
  .map((item) => item.pipeline.id)
  .sort()
  .join(',')
check('both example pipelines ship as built-ins', builtinIds === 'content,software')
check(
  'invalid pipeline reports errors',
  validatePipeline({ schemaVersion: 1, id: 'bad', stages: [] }).errors.length > 0
)
check(
  'condition sees prior evidence',
  evaluateCondition(
    { evidence: 'docs_impact', notIn: ['', 'none'] },
    new Map([['docs_impact', 'docs/features/ledger.md']])
  )
)
check(
  'a missing evidence key makes a condition false',
  !evaluateCondition({ evidence: 'docs_impact', notIn: ['', 'none'] }, new Map())
)
check(
  'an exists condition handles a missing key',
  !evaluateCondition({ evidence: 'docs_impact', exists: true }, new Map())
)
check(
  'software preset has one contract and one close stage',
  SOFTWARE_PIPELINE.stages.filter((stage) => stage.phase === 'contract').length === 1 &&
    SOFTWARE_PIPELINE.stages.filter((stage) => stage.phase === 'close').length === 1
)

// A shipped pipeline that names an agent nobody installs fails at the first
// stage, so the example must reference agents that exist in agents.json. User
// pipelines still get the runtime blocked decision; this only guards examples.
const definedAgents = new Set(Object.keys(agents.agents))
const shippedPipelines: Array<[string, { stages: Array<{ agent: string }> }]> = [
  ['built-in software', SOFTWARE_PIPELINE],
  ['built-in content', CONTENT_PIPELINE],
  [
    'reference software.json',
    JSON.parse(readFileSync(new URL('./pipelines/software.json', import.meta.url), 'utf8')),
  ],
  [
    'reference content.json',
    JSON.parse(readFileSync(new URL('./pipelines/content.json', import.meta.url), 'utf8')),
  ],
]
for (const [label, shipped] of shippedPipelines) {
  const missing = shipped.stages
    .map((stage) => stage.agent)
    .filter((agent) => !definedAgents.has(agent))
  check(`shipped ${label} names defined agents`, missing.length === 0, missing.join(', '))
}

const pipelineRoot = join(dir, 'pipelines')
mkdirSync(pipelineRoot, { recursive: true })
const contentPath = join(pipelineRoot, 'content.json')
writeFileSync(contentPath, `${JSON.stringify(CONTENT_PIPELINE, null, 2)}\n`)
check(
  'user pipeline loads from the config directory',
  loadPipeline('content').pipeline.name === CONTENT_PIPELINE.name
)

const pipelineWorkspace = join(dir, 'pipeline-workspace')
mkdirSync(pipelineWorkspace, { recursive: true })
const pinned = q.submit(db, {
  workspace: 'pipelines',
  path: pipelineWorkspace,
  title: 'Write the launch page copy',
  intent: 'A landing page has final copy ready to publish.',
  pipeline: 'content',
})
const pinnedId = Number(pinned.match(/submitted (\d+)/)![1])
const pinnedRequest = q.requestByRef(db, pinnedId)!
check('submit pins the chosen pipeline', pinnedRequest.pipeline_id === 'content')
check('submit pins the contract stage', pinnedRequest.current_stage_id === 'brief')
check(
  'submit stores a snapshot hash',
  pinnedRequest.pipeline_hash === pipelineHash(CONTENT_PIPELINE)
)
check(
  'submit stores the full snapshot',
  pipelineForRequest(db, pinnedRequest).stages.length === CONTENT_PIPELINE.stages.length
)

const changedContent = { ...CONTENT_PIPELINE, version: 2, name: 'Content request v2' }
writeFileSync(contentPath, `${JSON.stringify(changedContent, null, 2)}\n`)
check(
  'editing the file changes the loadable pipeline',
  loadPipeline('content').pipeline.version === 2
)
check(
  'in-flight requests keep their pinned snapshot',
  pipelineForRequest(db, q.requestByRef(db, pinnedId)!).name === CONTENT_PIPELINE.name
)

selectWorkspacePipeline(db, 'pipelines', 'content')
const defaulted = q.submit(db, {
  workspace: 'pipelines',
  title: 'Write the follow-up email',
  intent: 'The launch follow-up email is ready to send.',
})
const defaultedId = Number(defaulted.match(/submitted (\d+)/)![1])
check(
  'a workspace default pins the selected version',
  q.requestByRef(db, defaultedId)!.pipeline_version === 2
)

const badPath = join(pipelineRoot, 'bad.json')
writeFileSync(badPath, JSON.stringify({ schemaVersion: 1, id: 'bad' }))
let pipelineError = ''
try {
  loadPipeline('bad')
} catch (error) {
  pipelineError = (error as Error).message
}
check(
  'invalid pipeline is refused',
  pipelineError.includes('invalid pipeline "bad"'),
  pipelineError
)
rmSync(badPath)

console.log('\n0c. stage evidence')
q.setCriteria(db, {
  request: pinnedId,
  criteria: [{ text: 'the copy matches the brief', verification: 'artifact', check: 'copy' }],
})
expectThrow(
  'stage completion requires declared evidence',
  () =>
    q.stageDone(db, {
      request: pinnedId,
      stage: 'brief',
      evidence: {},
      actor: 'ai_1',
    }),
  'missing required evidence'
)
q.stageDone(db, {
  request: pinnedId,
  stage: 'brief',
  evidence: { brief: 'launch brief' },
  actor: 'ai_1',
})
check('stage completion is recorded', q.stageCompleted(db, pinnedId, 'brief'))
check('stage evidence is readable', q.stageEvidence(db, pinnedId).get('brief') === 'launch brief')
expectThrow(
  'unknown evidence is refused',
  () =>
    q.stageDone(db, {
      request: pinnedId,
      stage: 'brief',
      evidence: { brief: 'updated', mystery: true },
      actor: 'ai_1',
    }),
  'does not declare evidence'
)
q.progress(db, {
  request: pinnedId,
  stage: 'draft',
  metrics: { words: 240 },
  next: 'tighten the opening',
  tokens: 1200,
  actor: 'ai_1',
})
check('progress is recorded', q.latestProgress(db, pinnedId)?.n === 1)
check('progress updates tokens', q.requestByRef(db, pinnedId)!.tokens === 1200)
expectThrow(
  'a stage gate cannot clear before the stage completes',
  () =>
    q.stageGate(db, {
      request: pinnedId,
      stage: 'draft',
      result: 'verified',
      actor: 'human',
    }),
  'has not completed yet'
)
q.stageDone(db, {
  request: pinnedId,
  stage: 'draft',
  evidence: { copy: 'Build faster with Clara.', word_count: 4 },
  actor: 'ai_1',
})
q.stageGate(db, {
  request: pinnedId,
  stage: 'draft',
  result: 'verified',
  evidence: 'copy reviewed',
  actor: 'human',
})
check('a stage gate is recorded', q.stageGateVerified(db, pinnedId, 'draft', 'after'))
expectThrow(
  'a stage without a gate refuses one',
  () =>
    q.stageGate(db, {
      request: pinnedId,
      stage: 'brief',
      result: 'verified',
      actor: 'human',
    }),
  'does not declare a human gate'
)

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
const request = db.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
check('request exists', !!request)
check('state is draft', request.state === 'draft')
check('record written', existsSync(String(request.record_path)))
check(
  'record lives under docs/records',
  String(request.record_path).includes('/docs/records/'),
  String(request.record_path)
)
check(
  'event recorded',
  db.prepare('SELECT COUNT(*) c FROM events WHERE request_id = ?').get(request.id)!.c === 1
)

const sessionDir = join(dir, 'session-workspace')
mkdirSync(sessionDir, { recursive: true })
const sessionDb = await getDb(join(dir, 'session-ledger.db'))
const sessionSubmit = index.createTools(sessionDb).find((tool) => tool.name === 'submit')!
await sessionSubmit.execute(
  {
    workspace: 'session',
    path: sessionDir,
    title: 'A submit remembers the Clara session',
    intent: 'Later alerts return to the conversation where the human asked.',
  },
  { agent: 'clara', sessionID: 'ses_origin' }
)
const sessionRequest = sessionDb.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
const sessionWorkspace = sessionDb
  .prepare('SELECT * FROM workspaces WHERE name = ?')
  .get('session')!
check('submit records the originating session', sessionRequest.session_id === 'ses_origin')
check('submit records the workspace session', sessionWorkspace.session_id === 'ses_origin')
check(
  'request.submitted event names the session',
  JSON.parse(
    String(
      sessionDb.prepare('SELECT payload FROM events WHERE request_id = ?').get(sessionRequest.id)!
        .payload
    )
  ).session === 'ses_origin'
)
sessionDb.close()

console.log('\n2. criteria')
expectThrow(
  'rejects a criterion with no test and no human gate',
  () => q.setCriteria(db, { request: request.id, criteria: [{ text: 'it feels right' }] }),
  'no verification and no test_path or human_gate'
)

q.setCriteria(db, {
  request: request.id,
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
const criteria = db.prepare('SELECT * FROM criteria WHERE request_id = ?').all(request.id)
check('four criteria stored', criteria.length === 4)
check('one human gate', criteria.filter((c: any) => c.verification === 'human').length === 1)
check(
  'none approved yet',
  criteria.every((c: any) => !c.approved_at)
)
q.stageDone(db, {
  request: request.id,
  stage: 'spec',
  evidence: { criteria_count: 4, docs_impact: 'none' },
  actor: 'ai_1',
})

console.log('\n3. approval gate')
let blocked = ''
try {
  await tools.get('clara_approve')!.execute({ request: request.id }, { agent: '003' })
} catch (error) {
  blocked = (error as Error).message
}
check('implementer cannot approve criteria', blocked.includes('not available to 003'), blocked)
let unknownRole = ''
try {
  await tools.get('clara_approve')!.execute({ request: request.id }, { agent: 'custom-agent' })
} catch (error) {
  unknownRole = (error as Error).message
}
check('an unknown agent has no write privileges', unknownRole.includes('role unknown'), unknownRole)

q.approve(db, { request: request.id })
const afterApprove = q.requestByRef(db, request.id)!
check('state is approved', afterApprove.state === 'approved')
check(
  'criteria approved',
  db
    .prepare('SELECT * FROM criteria WHERE request_id = ?')
    .all(request.id)
    .every((c: any) => c.approved_at)
)

console.log('\n4. evidence + progress')
q.stageDone(db, {
  request: request.id,
  stage: 'test',
  evidence: { tests_hash: '8f3ac21d', tests_total: 4 },
  actor: 'ai_2',
})
q.appendEvent(db, { request: request.id, type: 'build.started', actor: 'ai_3', state: 'running' })
check('state is running', q.requestByRef(db, request.id)!.state === 'running')

q.progress(db, {
  request: request.id,
  stage: 'build',
  metrics: { tests_passed: 1, tests_total: 4, files_changed: 3, criteria_addressed: [1] },
  next: 'add injectable clock',
  tokens: 40_000,
  actor: 'ai_3',
})
q.progress(db, {
  request: request.id,
  stage: 'build',
  metrics: { tests_passed: 1, tests_total: 4, files_changed: 5, criteria_addressed: [1] },
  blocked_on: 'clock abstraction missing from the harness',
  tokens: 55_000,
  actor: 'ai_3',
})
const cps = db.prepare('SELECT * FROM progress WHERE request_id = ? ORDER BY n').all(request.id)
check('two progress reports', cps.length === 2)
check('tokens accumulated', q.requestByRef(db, request.id)!.tokens === 95_000)

console.log('\n5. inbox')
check(
  'inbox empty when nothing needs a human',
  q.inbox(db, { workspace: 'clara' }).startsWith('inbox: empty')
)

const decisionId = Number(
  q
    .decide(db, {
      request: request.id,
      kind: 'decision',
      question: 'The clock abstraction is missing. Add it, or drop the expiry criterion?',
      recommendation: 'add an injectable clock — dropping expiry is a security regression',
      evidence: '2 progress reports, tests stuck at 1/4',
      reversible: true,
      cost: '~80k tokens',
      default_if_silent: 'block',
    })
    .match(/#(\d+)/)![1]
)

const inbox = q.inbox(db, { workspace: 'clara' })
check('inbox shows the decision', inbox.includes('clock abstraction'))
check('inbox shows the default', inbox.includes('default if silent: block'))

console.log('\n6. ask')
const asked = q.ask(db, { question: 'what is 001 doing?', request: request.id })
check('ask reports state', asked.includes('state:     running'))
check('ask reports criteria', asked.includes('4/4 approved'))
check('ask reports progress', asked.includes('progress (latest first)'))
check('ask reports criteria covered by progress', asked.includes('criteria_addressed=1'))
check('ask reports the frozen test hash', asked.includes('test.tests_hash: 8f3ac21d'))
check('ask reports unverified human gates', asked.includes('human:     UNVERIFIED (4)'))
check('ask reports the current blocker', asked.includes('blocked:   clock abstraction'))
check('ask marks the record frontmatter historical', asked.includes('frontmatter is historical'))
check(
  'ask works without a question when scoped to a request',
  q.ask(db, { request: request.id }).includes('state:     running')
)
const askTool = await tools.get('clara_ask')!.execute({ request: request.id }, { agent: 'clara' })
check(
  'ask tool accepts a request without a question',
  String(askTool.content).includes('state:     running')
)

const missing = q.ask(db, {
  question: 'what did we decide about billing?',
  request: 'does-not-exist',
})
check('unanswerable question records a gap', missing.includes('Gap recorded'))
check('gap persisted', db.prepare('SELECT COUNT(*) c FROM schema_gaps').get()!.c === 1)

console.log('\n7. state machine')
expectThrow(
  'building cannot jump to done',
  () => q.appendEvent(db, { request: request.id, type: 'x', actor: 'ai_0', state: 'completed' }),
  'illegal transition'
)

q.appendEvent(db, { request: request.id, type: 'close.requested', actor: 'ai_3', state: 'review' })
check('state is review', q.requestByRef(db, request.id)!.state === 'review')
check('review clears the stale blocker', !q.requestByRef(db, request.id)!.blocked_on)
check(
  'ask no longer shows the blocked header',
  !q.ask(db, { request: request.id }).includes('blocked:   clock abstraction')
)

let gateRole = ''
try {
  await tools.get('clara_gate')!.execute({ request: request.id }, { agent: 'judge' })
} catch (error) {
  gateRole = (error as Error).message
}
check('judge cannot record a human gate', gateRole.includes('not available to judge'), gateRole)

expectThrow(
  'only human-gate criteria can be confirmed',
  () => q.gate(db, { request: request.id, criteria: [1] }),
  'not human gates'
)

const gated = await tools
  .get('clara_gate')!
  .execute({ request: request.id, evidence: 'email copy reviewed' }, { agent: 'clara' })
check(
  'human records the gate through the tool',
  String(gated.content).includes('human gates verified — 4'),
  String(gated.content)
)
const afterGate = q.ask(db, { request: request.id })
check('ask shows the gate verified', afterGate.includes('human:     verified 4'))
check('recent events explain the gate', afterGate.includes('human.gates (4 verified)'))

q.gate(db, { request: request.id, criteria: [4], result: 'rejected' })
check('a rejection reopens the gate', q.ask(db, { request: request.id }).includes('UNVERIFIED (4)'))
q.gate(db, { request: request.id, criteria: [4] })
check(
  'a later verification wins',
  q.ask(db, { request: request.id }).includes('human:     verified 4')
)

expectThrow(
  'ai_3 cannot close a request',
  () =>
    q.appendEvent(db, {
      request: request.id,
      type: 'close.confirmed',
      actor: 'ai_3',
      state: 'completed',
    }),
  'only ai_0'
)

let spoofed = ''
try {
  await tools
    .get('clara_event')!
    .execute(
      { request: request.id, type: 'close.confirmed', actor: 'ai_0', state: 'completed' },
      { agent: '003' }
    )
} catch (error) {
  spoofed = (error as Error).message
}
check('implementer cannot spoof actor=ai_0', spoofed.includes('only ai_0'), spoofed)

const confirmed = await tools
  .get('clara_event')!
  .execute({ request: request.id, type: 'close.confirmed', state: 'completed' }, { agent: 'judge' })
check('ai_0 confirms close through the tool', String(confirmed.content).includes('state=completed'))
const done = q.requestByRef(db, request.id)!
check('state is completed', done.state === 'completed')
check('closed_at set', !!done.closed_at)

console.log('\n8. resolve')
q.resolveDecision(db, { id: decisionId, resolution: 'add the clock' })
check(
  'decision resolved',
  !!db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId)!.resolved_at
)
check('inbox empty again', q.inbox(db, { workspace: 'clara' }).startsWith('inbox: empty'))

console.log('\n9. tick')
const stalled = q.submit(db, {
  workspace: 'clara',
  title: 'Export a CSV',
  intent: 'A user can export their data as CSV.',
  soft_budget: 1000,
  hard_budget: 5000,
})
const stalledId = Number(stalled.match(/submitted (\d+)/)![1])
q.setCriteria(db, {
  request: stalledId,
  criteria: [{ text: 'export works', test_path: 'tests/export.test.ts' }],
})
q.stageDone(db, {
  request: stalledId,
  stage: 'spec',
  evidence: { criteria_count: 1, docs_impact: 'none' },
  actor: 'ai_1',
})
q.approve(db, { request: stalledId })
q.appendEvent(db, { request: stalledId, type: 'build.started', actor: 'ai_3', state: 'running' })
db.prepare('UPDATE requests SET tokens = 6000, last_event_at = ? WHERE id = ?').run(
  new Date(Date.now() - 30 * 60_000).toISOString(),
  stalledId
)

const dry = q.tick(db, { dry_run: true })
check('tick dry run reports but does not act', dry.includes('WOULD'))
check('dry run did not kill', q.requestByRef(db, stalledId)!.state === 'running')

const live = q.tick(db, { dry_run: false })
check('tick kills over hard budget', q.requestByRef(db, stalledId)!.state === 'cancelled')
check('scrap reason recorded', q.requestByRef(db, stalledId)!.cancel_reason === 'budget')
check('tick output mentions the kill', live.includes('cancelled'))

const stallSubmit = q.submit(db, {
  workspace: 'clara',
  title: 'A live worker can stall',
  intent: 'A stalled request asks a human instead of waiting forever.',
})
const stallId = Number(stallSubmit.match(/submitted (\d+)/)![1])
q.setCriteria(db, {
  request: stallId,
  criteria: [{ text: 'stall detection works', test_path: 'tests/stall.test.ts' }],
})
q.stageDone(db, {
  request: stallId,
  stage: 'spec',
  evidence: { criteria_count: 1, docs_impact: 'none' },
  actor: 'ai_1',
})
q.approve(db, { request: stallId })
q.appendEvent(db, { request: stallId, type: 'build.started', actor: 'ai_3', state: 'running' })
runs.startRun(db, stallId, 'build', '003', 'worker')
db.prepare('UPDATE requests SET last_event_at = ? WHERE id = ?').run(
  new Date(Date.now() - 20 * 60_000).toISOString(),
  stallId
)
q.tick(db, { dry_run: false })
check(
  'a live worker with no events is marked stalled',
  Boolean(q.requestByRef(db, stallId)!.stalled_at)
)

console.log('\n10. record file')
const record = await import('node:fs').then((fs) =>
  fs.readFileSync(String(q.requestByRef(db, request.id)!.record_path), 'utf8')
)
check('record has front matter', record.startsWith('---'))
check('record has non-goals', record.includes('password login'))
check('record has criteria table', record.includes('| # | Criterion | Verification | Check |'))
check('record has progress', record.includes('**#2**'))

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
  attention: false,
  logger: silent,
})

const daemonSubmit = q.submit(ddb, {
  workspace: 'daemon',
  path: daemonWorkspace,
  title: 'The daemon drives a request',
  intent: 'A request reaches done without a human launching each stage.',
})
const daemonId = Number(daemonSubmit.match(/submitted (\d+)/)![1])

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
  request: daemonId,
  criteria: [{ text: 'the daemon drives the request', test_path: 'tests/daemon.test.ts' }],
  docs_impact: 'update docs/features/daemon.md',
})
q.stageDone(ddb, {
  request: daemonId,
  stage: 'spec',
  evidence: { criteria_count: 1, docs_impact: 'update docs/features/daemon.md' },
  actor: 'ai_1',
})
sessions[0].outcome = 'succeeded'
await supervisor.runOnce()
check('spec run is done', runs.latestRun(ddb, daemonId, 'spec')?.status === 'done')
check('daemon waits for approval', sessions.length === 1)

q.approve(ddb, { request: daemonId })
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

q.stageDone(ddb, {
  request: daemonId,
  stage: 'test',
  evidence: { tests_hash: 'daemon-hash', tests_total: 1 },
  actor: 'ai_2',
})
sessions[1].outcome = 'succeeded'
await supervisor.runOnce()
check('test run is done', runs.latestRun(ddb, daemonId, 'test')?.status === 'done')
check('daemon starts the build stage', sessions.length === 3 && sessions[2].agent === '003')
check('daemon moved the request to running', q.requestByRef(ddb, daemonId)!.state === 'running')

q.progress(ddb, {
  request: daemonId,
  stage: 'build',
  metrics: { tests_passed: 1, tests_total: 1, files_changed: 2 },
  next: 'finish the last edge case',
  tokens: 2000,
  actor: 'ai_3',
})
const daemonAsk = q.ask(ddb, { request: daemonId })
check('ask reports progress', daemonAsk.includes('progress (latest first)'))
check(
  'ask lists the live run with its session',
  daemonAsk.includes('build running (003 ses_daemon_3')
)
check('ask reports no human gates for this request', daemonAsk.includes('human:     no gates'))

q.stageDone(ddb, {
  request: daemonId,
  stage: 'build',
  evidence: { summary: 'daemon request implemented', criteria_addressed: [1] },
  actor: 'ai_3',
})
sessions[2].outcome = 'succeeded'
await supervisor.runOnce()
check('build run is done', runs.latestRun(ddb, daemonId, 'build')?.status === 'done')
check('daemon starts the docs stage', sessions.length === 4 && sessions[3].agent === '004')

q.stageDone(ddb, { request: daemonId, stage: 'docs', actor: 'ai_4' })
sessions[3].outcome = 'succeeded'
await supervisor.runOnce()
check('docs run is done', runs.latestRun(ddb, daemonId, 'docs')?.status === 'done')
check('daemon starts the judge stage', sessions.length === 5 && sessions[4].agent === 'judge')
check(
  'judge handoff points at the ledger and the gates',
  sessions[4].prompt.includes('clara_ask') && sessions[4].prompt.includes('human gates')
)

q.stageDone(ddb, {
  request: daemonId,
  stage: 'judge',
  evidence: { result: 'request delivered', artifacts: [] },
  actor: 'ai_0',
})
sessions[4].outcome = 'succeeded'
await supervisor.runOnce()
check('judge run is done', runs.latestRun(ddb, daemonId, 'judge')?.status === 'done')
check('daemon does not spawn after done', sessions.length === 5)
check('request is completed', q.requestByRef(ddb, daemonId)!.state === 'completed')

const failedSubmit = q.submit(ddb, {
  workspace: 'daemon',
  path: daemonWorkspace,
  title: 'The daemon handles a failed stage',
  intent: 'A failed stage asks the human instead of retrying blindly.',
})
const failedId = Number(failedSubmit.match(/submitted (\d+)/)![1])
await supervisor.runOnce()
const failedSession = sessions[sessions.length - 1]
check(
  'failed request starts a spec session',
  failedSession.agent === '001',
  JSON.stringify(sessions.map((s) => `${s.id}:${s.agent}`))
)
failedSession.outcome = 'failed'
await supervisor.runOnce()
check('failed run is recorded', runs.latestRun(ddb, failedId, 'spec')?.status === 'failed')
const open = ddb
  .prepare('SELECT * FROM decisions WHERE request_id = ? AND resolved_at IS NULL')
  .get(failedId)
check('failed run opens a decision', Boolean(open))
check('failed run does not spawn again', sessions.length === 6)

q.resolveDecision(ddb, { id: Number(open!.id), resolution: 'retry' })
await supervisor.runOnce()
check('resolved decision retries the stage', sessions.length === 7 && sessions[6].agent === '001')

// A non-software pipeline with no tests and no docs must run through the same
// daemon loop. The mock session API does not care which agents exist.
const contentWorkspace = join(daemonDir, 'content-workspace')
mkdirSync(contentWorkspace, { recursive: true })
const daemonTools = index.createTools(ddb)

const contentSubmit = q.submit(ddb, {
  workspace: 'content',
  path: contentWorkspace,
  title: 'Write launch page copy',
  intent: 'A landing page has final copy ready to publish.',
  pipeline: 'content',
})
const contentId = Number(contentSubmit.match(/submitted (\d+)/)![1])
q.setCriteria(ddb, {
  request: contentId,
  criteria: [{ text: 'the copy matches the brief', verification: 'artifact', check: 'copy' }],
})

await supervisor.runOnce()
const briefSession = sessions[sessions.length - 1]
check('content pipeline starts its contract agent', briefSession.agent === 'clara-brief')
q.stageDone(ddb, {
  request: contentId,
  stage: 'brief',
  evidence: { brief: 'audience: developers; tone: direct; length: 300 words' },
  actor: 'ai_1',
})
briefSession.outcome = 'succeeded'
await supervisor.runOnce()
check('content contract waits for approval', sessions.length === 8)
q.approve(ddb, { request: contentId })
await supervisor.runOnce()
const draftSession = sessions[sessions.length - 1]
check('content pipeline starts its work agent', draftSession.agent === 'clara-writer')
check('content request is running', q.requestByRef(ddb, contentId)!.state === 'running')
await daemonTools
  .find((tool) => tool.name === 'stage_done')!
  .execute(
    {
      request: contentId,
      stage: 'draft',
      evidence: { copy: 'Build faster with Clara.', word_count: 4 },
    },
    { agent: 'clara-writer', sessionID: draftSession.id }
  )
let wrongStage = ''
try {
  await daemonTools
    .find((tool) => tool.name === 'stage_done')!
    .execute(
      { request: contentId, stage: 'deliver', evidence: { result: 'too early', artifacts: [] } },
      { agent: 'clara-writer', sessionID: draftSession.id }
    )
} catch (error) {
  wrongStage = (error as Error).message
}
check('a worker cannot complete another stage', wrongStage.includes('owns draft'), wrongStage)
collectAlerts(ddb)
const pendingStageGate = ddb
  .prepare('SELECT * FROM alerts WHERE key = ? AND resolved_at IS NULL')
  .get(`stage_gate:${contentId}:draft:after`)
check('a pending stage gate creates an alert', Boolean(pendingStageGate))
q.stageGate(ddb, {
  request: contentId,
  stage: 'draft',
  result: 'verified',
  evidence: 'draft approved',
  actor: 'human',
})
collectAlerts(ddb)
const closedStageGate = ddb
  .prepare('SELECT resolved_at FROM alerts WHERE key = ?')
  .get(`stage_gate:${contentId}:draft:after`)
check('verifying a stage gate resolves the alert', Boolean(closedStageGate?.resolved_at))
draftSession.outcome = 'succeeded'
await supervisor.runOnce()
check(
  'content gate lets the review stage start',
  sessions[sessions.length - 1].agent === 'clara-editor'
)
q.stageDone(ddb, {
  request: contentId,
  stage: 'edit',
  evidence: { final_copy: 'Build faster with Clara.', changes: 'kept it short' },
  actor: 'ai_1',
})
sessions[sessions.length - 1].outcome = 'succeeded'
await supervisor.runOnce()
check('content pipeline starts its closer', sessions[sessions.length - 1].agent === 'judge')
await daemonTools
  .find((tool) => tool.name === 'stage_done')!
  .execute(
    {
      request: contentId,
      stage: 'deliver',
      evidence: { result: 'Launch copy delivered', artifacts: ['https://example.test/copy'] },
    },
    { agent: 'judge', sessionID: sessions[sessions.length - 1].id }
  )
sessions[sessions.length - 1].outcome = 'succeeded'
await supervisor.runOnce()
const contentDone = q.requestByRef(ddb, contentId)!
check('content request completes', contentDone.state === 'completed')
check(
  'content result is recorded',
  q.stageEvidence(ddb, contentId).get('result') === 'Launch copy delivered'
)
check(
  'ask shows the content result',
  q.ask(ddb, { request: contentId }).includes('Launch copy delivered')
)

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
const waitId = Number(waitSubmit.match(/submitted (\d+)/)![1])
q.setCriteria(db, {
  request: waitId,
  criteria: [{ text: 'a human verifies the wait state', human_gate: true }],
  docs_impact: 'none',
})
q.stageDone(db, {
  request: waitId,
  stage: 'spec',
  evidence: { criteria_count: 1, docs_impact: 'none' },
  actor: 'ai_1',
})
collectAlerts(db)
const approvalAlert = db
  .prepare('SELECT * FROM alerts WHERE key = ? AND resolved_at IS NULL')
  .get(`approval:${waitId}`)
check('criteria approval creates an alert', Boolean(approvalAlert))

q.approve(db, { request: waitId })
collectAlerts(db)
const approvalClosed = db
  .prepare('SELECT resolved_at FROM alerts WHERE key = ?')
  .get(`approval:${waitId}`)
check('approval resolves the alert', Boolean(approvalClosed?.resolved_at))

q.appendEvent(db, { request: waitId, type: 'build.started', actor: 'ai_0', state: 'running' })
q.appendEvent(db, { request: waitId, type: 'build.review', actor: 'ai_0', state: 'review' })
collectAlerts(db)
const gateAlert = db
  .prepare('SELECT * FROM alerts WHERE key = ? AND resolved_at IS NULL')
  .get(`review_gate:${waitId}`)
check('review gates create an alert', Boolean(gateAlert))

q.gate(db, { request: waitId, criteria: [1] })
collectAlerts(db)
const gateClosed = db
  .prepare('SELECT resolved_at FROM alerts WHERE key = ?')
  .get(`review_gate:${waitId}`)
check('gate verification resolves the alert', Boolean(gateClosed?.resolved_at))

db.prepare(
  "UPDATE alerts SET session_id = 'ses_gate', notified_at = ?, attention_state = 'info' WHERE key = ?"
).run(new Date().toISOString(), `review_gate:${waitId}`)
q.gate(db, { request: waitId, criteria: [1], result: 'rejected' })
collectAlerts(db)
const gateReopened = db
  .prepare('SELECT session_id, notified_at, attention_state FROM alerts WHERE key = ?')
  .get(`review_gate:${waitId}`)
check(
  'a reopened gate clears its delivery',
  gateReopened?.session_id === null &&
    gateReopened?.notified_at === null &&
    gateReopened?.attention_state === null
)

const decisionAlert = q.decide(db, {
  request: waitId,
  kind: 'decision',
  question: 'Should this wait state be tested?',
})
collectAlerts(db)
const openDecision = db
  .prepare("SELECT * FROM alerts WHERE key LIKE 'decision:%' AND resolved_at IS NULL")
  .get()
check('an open decision creates an alert', Boolean(openDecision), decisionAlert)

console.log('\n15. attention tool')
const attentionWorkspace = join(dir, 'attention-workspace')
mkdirSync(attentionWorkspace, { recursive: true })
const attentionDb = await getDb(join(dir, 'attention-ledger.db'))
q.submit(attentionDb, {
  workspace: 'attention',
  path: attentionWorkspace,
  title: 'A ledger exception can be presented',
  intent: 'Clara asks the human in the session that already has the context.',
  session_id: 'ses_attention',
})
const attentionRequest = attentionDb
  .prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1')
  .get()!
attentionDb
  .prepare(
    `INSERT INTO alerts
      (key, request_id, slug, workspace, kind, title, body, created_at)
     VALUES (?, ?, ?, ?, 'approval', ?, ?, ?)`
  )
  .run(
    `approval:${attentionRequest.id}`,
    attentionRequest.id,
    attentionRequest.slug,
    'attention',
    `${String(attentionRequest.id).padStart(3, '0')} ${attentionRequest.slug} · criteria awaiting approval`,
    '2 criteria proposed; 2 still need clara_approve.',
    new Date().toISOString()
  )
const attentionAlertKey = `approval:${attentionRequest.id}`
const attentionRequestId = Number(attentionRequest.id)
const attentionTools = index.createTools(attentionDb)
const attentionTool = attentionTools.find((tool) => tool.name === 'attention')!

const infoResult = await attentionTool.execute(
  { alert: attentionAlertKey, state: 'info', title: 'Informational' },
  { agent: 'clara', sessionID: 'ses_attention' }
)
check('info records an attention item', String(infoResult.content).includes('recorded'))
check(
  'info marks the alert attention state',
  attentionDb.prepare('SELECT attention_state FROM alerts WHERE key = ?').get(attentionAlertKey)!
    .attention_state === 'info'
)
check(
  'info writes a request event',
  attentionDb
    .prepare("SELECT COUNT(*) c FROM events WHERE request_id = ? AND type = 'attention.info'")
    .get(attentionRequestId)!.c === 1
)

const prose = await attentionTool.execute(
  { alert: attentionAlertKey, state: 'feedback', prompt: 'Ship it?' },
  { agent: 'clara', sessionID: 'ses_attention' }
)
check(
  'attention falls back to prose without a form API',
  String(prose.content).includes('in prose')
)

const created: any[] = []
const fakeForms = {
  async create(input: any) {
    created.push(input)
    return { id: 'form_attention' }
  },
  async get() {
    return {
      id: 'form_attention',
      state: { status: 'answered' as const, answer: { response: 'ship it' } },
    }
  },
  async cancel() {},
}
const formTool = index
  .createTools(attentionDb, undefined, fakeForms)
  .find((tool) => tool.name === 'attention')!
const answered = await formTool.execute(
  { alert: attentionAlertKey, state: 'feedback', prompt: 'Ship it?' },
  { agent: 'clara', sessionID: 'ses_attention' }
)
check('feedback posts a standard form', created[0]?.fields?.[0]?.key === 'response')
check('feedback uses the current session', created[0]?.sessionID === 'ses_attention')
check('feedback returns the answer to Clara', String(answered.content).includes('ship it'))
check(
  'feedback records the answer',
  attentionDb
    .prepare("SELECT COUNT(*) c FROM events WHERE request_id = ? AND type = 'attention.answered'")
    .get(attentionRequestId)!.c === 1
)

const confirmForms = {
  async create() {
    return { id: 'form_confirm' }
  },
  async get() {
    return {
      id: 'form_confirm',
      state: { status: 'answered' as const, answer: { confirm: false } },
    }
  },
  async cancel() {},
}
const confirmTool = index
  .createTools(attentionDb, undefined, confirmForms)
  .find((tool) => tool.name === 'attention')!
const refused = await confirmTool.execute(
  { alert: attentionAlertKey, state: 'confirm', confirm_label: 'Start' },
  { agent: 'clara', sessionID: 'ses_attention' }
)
check(
  'confirm tells Clara not to start on false',
  String(refused.content).includes('did not confirm')
)

attentionDb
  .prepare('UPDATE alerts SET resolved_at = ? WHERE key = ?')
  .run(new Date().toISOString(), attentionAlertKey)
const stale = await attentionTool.execute(
  { alert: attentionAlertKey, state: 'feedback' },
  { agent: 'clara', sessionID: 'ses_attention' }
)
check('a resolved alert is refused', String(stale.content).includes('already resolved'))
attentionDb.close()

console.log('\n16. attention delivery')
const deliveryWorkspace = join(dir, 'delivery-workspace')
mkdirSync(deliveryWorkspace, { recursive: true })
const deliveryDb = await getDb(join(dir, 'delivery-ledger.db'))
q.submit(deliveryDb, {
  workspace: 'delivery',
  path: deliveryWorkspace,
  title: 'Alerts return to the submitting session',
  intent: 'The human keeps one conversation per request.',
  session_id: 'ses_existing',
})
const deliveryRequest = deliveryDb.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
const insertDeliveryAlert = (key: string, requestId: number, slug: string, workspace: string) => {
  deliveryDb
    .prepare(
      `INSERT INTO alerts
        (key, request_id, slug, workspace, kind, title, body, created_at)
       VALUES (?, ?, ?, ?, 'decision', ?, ?, ?)`
    )
    .run(
      key,
      requestId,
      slug,
      workspace,
      `${String(requestId).padStart(3, '0')} ${slug} · decision`,
      'Choose one.',
      new Date().toISOString()
    )
}
insertDeliveryAlert(
  `decision:${deliveryRequest.id}`,
  Number(deliveryRequest.id),
  String(deliveryRequest.slug),
  'delivery'
)

const prompts: any[] = []
const createdSessions: any[] = []
const removedSessions: string[] = []
const knownSessions = new Map<string, any>([
  ['ses_existing', { id: 'ses_existing', agent: 'clara', metadata: {}, time: {} }],
])
const attentionSessionApi = {
  async get({ sessionID }: { sessionID: string }) {
    const found = knownSessions.get(sessionID)
    if (!found) throw new Error(`no session ${sessionID}`)
    return found
  },
  async prompt(input: any) {
    prompts.push(input)
  },
  async remove({ sessionID }: { sessionID: string }) {
    removedSessions.push(sessionID)
  },
}
const createDeliverySession = async (input: any) => {
  createdSessions.push(input)
  const created = { id: `ses_created_${createdSessions.length}` }
  knownSessions.set(created.id, { id: created.id, agent: 'clara', metadata: {}, time: {} })
  return created
}

const delivered = await deliverAttention({
  db: deliveryDb,
  session: attentionSessionApi as any,
  createSession: createDeliverySession,
  fallbackDirectory: deliveryWorkspace,
})
check('attention prompts the linked session', prompts[0]?.sessionID === 'ses_existing')
check(
  'attention handoff is a daemon synthetic prompt',
  prompts[0]?.metadata?.source === 'daemon' && prompts[0]?.metadata?.synthetic === true
)
check('attention prompt is queued', prompts[0]?.delivery === 'queue')
check(
  'attention prompt names clara_attention',
  String(prompts[0]?.text).includes('clara_attention')
)
check('attention does not create a session when one exists', createdSessions.length === 0)
check(
  'attention marks the alert delivered',
  deliveryDb
    .prepare('SELECT session_id FROM alerts WHERE key = ?')
    .get(`decision:${deliveryRequest.id}`)!.session_id === 'ses_existing'
)
check('attention reports what it did', delivered[0]?.includes('alerted ses_existing'))

await deliverAttention({
  db: deliveryDb,
  session: attentionSessionApi as any,
  createSession: createDeliverySession,
  fallbackDirectory: deliveryWorkspace,
})
check('attention delivers each alert once', prompts.length === 1)

const missingWorkspace = join(dir, 'delivery-missing')
mkdirSync(missingWorkspace, { recursive: true })
q.submit(deliveryDb, {
  workspace: 'delivery-missing',
  path: missingWorkspace,
  title: 'A request without a session gets one',
  intent: 'The daemon creates and links a Clara session.',
})
const missingRequest = deliveryDb.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
insertDeliveryAlert(
  `decision:${missingRequest.id}`,
  Number(missingRequest.id),
  String(missingRequest.slug),
  'delivery-missing'
)
await deliverAttention({
  db: deliveryDb,
  session: attentionSessionApi as any,
  createSession: createDeliverySession,
  fallbackDirectory: deliveryWorkspace,
})
check('attention creates a session when none exists', createdSessions.length === 1)
check(
  'created attention session is not automation',
  createdSessions[0]?.metadata?.initiatedBy === 'clara' &&
    createdSessions[0]?.metadata?.ledgerAlert === true &&
    createdSessions[0]?.metadata?.automation === undefined
)
check('attention prompts the created session', prompts[1]?.sessionID === 'ses_created_1')
check(
  'attention links the new session to the request',
  deliveryDb.prepare('SELECT session_id FROM requests WHERE id = ?').get(missingRequest.id)!
    .session_id === 'ses_created_1'
)

const archivedWorkspace = join(dir, 'delivery-archived')
mkdirSync(archivedWorkspace, { recursive: true })
q.submit(deliveryDb, {
  workspace: 'delivery-archived',
  path: archivedWorkspace,
  title: 'An archived session is replaced',
  intent: 'The alert does not disappear into archive.',
  session_id: 'ses_archived',
})
const archivedRequest = deliveryDb.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
knownSessions.set('ses_archived', {
  id: 'ses_archived',
  agent: 'clara',
  metadata: {},
  time: { archived: Date.now() },
})
insertDeliveryAlert(
  `decision:${archivedRequest.id}`,
  Number(archivedRequest.id),
  String(archivedRequest.slug),
  'delivery-archived'
)
await deliverAttention({
  db: deliveryDb,
  session: attentionSessionApi as any,
  createSession: createDeliverySession,
  fallbackDirectory: deliveryWorkspace,
})
check('attention replaces an archived session', createdSessions.length === 2)
check(
  'attention relinks an archived request',
  deliveryDb.prepare('SELECT session_id FROM requests WHERE id = ?').get(archivedRequest.id)!
    .session_id === 'ses_created_2'
)

const failureDb = await getDb(join(dir, 'delivery-failure.db'))
q.submit(failureDb, {
  workspace: 'delivery-failure',
  path: deliveryWorkspace,
  title: 'A failed prompt is retried',
  intent: 'No alert is lost when the session API fails.',
})
const failureRequest = failureDb.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 1').get()!
failureDb
  .prepare(
    `INSERT INTO alerts
      (key, request_id, slug, workspace, kind, title, body, created_at)
     VALUES (?, ?, ?, ?, 'decision', ?, ?, ?)`
  )
  .run(
    `decision:${failureRequest.id}`,
    failureRequest.id,
    failureRequest.slug,
    'delivery-failure',
    'Fails to prompt',
    'Choose one.',
    new Date().toISOString()
  )
await deliverAttention({
  db: failureDb,
  session: {
    async get() {
      throw new Error('missing')
    },
    async prompt() {
      throw new Error('prompt failed')
    },
    async remove({ sessionID }: { sessionID: string }) {
      removedSessions.push(sessionID)
    },
  } as any,
  createSession: async () => ({ id: 'ses_failure' }),
  fallbackDirectory: deliveryWorkspace,
})
check(
  'a failed prompt leaves the alert undelivered',
  failureDb
    .prepare('SELECT session_id FROM alerts WHERE key = ?')
    .get(`decision:${failureRequest.id}`)!.session_id === null
)
check('a failed prompt removes the new session', removedSessions.includes('ses_failure'))
failureDb.close()
deliveryDb.close()

rmSync(dir, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.error(`${failures} failed`)
  process.exit(1)
}
