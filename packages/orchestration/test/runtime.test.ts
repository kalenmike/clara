import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { reserveTokens } from '@clara/policy'
import { Runtime, Store, loadCatalog } from '../src/index.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const defaults = loadCatalog(join(workspace, 'orchestration', 'index.yml')).root.manifest.defaults
let store: Store
let runtime: Runtime

beforeEach(() => {
  store = new Store(':memory:')
  runtime = new Runtime({ store, configPath: `${workspace}/orchestration/index.yml` })
})

function adapter(): void {
  runtime.registerAdapter({
    harness: 'opencode',
    workspace,
    capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
  })
}

function budgetRuntime(options: { attempts: number; onExhausted: 'keep' | 'fail' }) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-budget-'))
  mkdirSync(join(dir, 'orchestration', 'tasks'), { recursive: true })
  writeFileSync(
    join(dir, 'orchestration', 'index.yml'),
    [
      'id: temp',
      'name: Temp',
      'version: 1',
      'entry:',
      '  pipeline: work',
      'pipelines:',
      '  work:',
      '    enforcement: strict',
      '    steps:',
      '      - name: do_work',
      '        type: task',
    ].join('\n')
  )
  writeFileSync(
    join(dir, 'orchestration', 'tasks', 'do_work.md'),
    [
      '---',
      'description: Do work',
      'limits:',
      '  tokens:',
      '    initial: 1000',
      `  on_exhausted: ${options.onExhausted}`,
      'retries:',
      `  auto_attempts: ${options.attempts}`,
      '---',
      '',
      '# Do work',
    ].join('\n')
  )
  const tempStore = new Store(':memory:')
  const tempRuntime = new Runtime({
    store: tempStore,
    configPath: join(dir, 'orchestration', 'index.yml'),
  })
  tempRuntime.registerAdapter({
    harness: 'opencode',
    workspace: dir,
    capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
  })
  return { runtime: tempRuntime, store: tempStore, dir }
}

function wiringRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'clara-wiring-'))
  mkdirSync(join(dir, 'orchestration'), { recursive: true })
  writeFileSync(
    join(dir, 'orchestration', 'index.yml'),
    [
      'id: temp',
      'name: Temp',
      'version: 1',
      'entry:',
      '  pipeline: work',
      'pipelines:',
      '  work:',
      '    steps:',
      '      - name: first',
      '        type: task',
      '        prompt: do it',
      '      - name: zero',
      '        type: task',
      '        prompt: do it',
      '      - name: second',
      '        type: task',
      '        prompt: do it',
      '        inputs:',
      '          one: first',
      '        artifacts:',
      '          - spec.md',
      '          - missing.md',
    ].join('\n')
  )
  const tempStore = new Store(':memory:')
  const tempRuntime = new Runtime({
    store: tempStore,
    configPath: join(dir, 'orchestration', 'index.yml'),
  })
  return { runtime: tempRuntime, store: tempStore, dir }
}

describe('runtime', () => {
  it('fails closed for strict runs without an adapter', () => {
    expect(() =>
      runtime.start({ workspace, prompt: 'build it', target: 'std:software/feature' })
    ).toThrow(/strict enforcement/)
  })

  it('starts, completes, and advances a strict pipeline', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'build a feature',
      target: 'std:software/feature',
    })
    expect(started.work).toHaveLength(1)
    expect(started.work[0].name).toBe('create_spec')
    expect(started.work[0].provider).toBe(defaults?.provider)
    expect(started.work[0].model).toBe(defaults?.model)
    expect(started.work[0].work_token).toBeTruthy()

    const completed = runtime.complete(
      started.run.id,
      started.work[0].step_path,
      started.work[0].work_token,
      { summary: 'spec ready' }
    )
    expect(completed.ready.map((step) => step.name)).toContain('plan_implementation')
    const next = runtime.next(started.run.id)
    expect(next[0].name).toBe('plan_implementation')
  })

  it('carries only declared inputs and artifact paths in the work order', () => {
    const { runtime: temp, dir } = wiringRuntime()
    try {
      writeFileSync(join(dir, 'spec.md'), '# Spec')
      const started = temp.start({ workspace: dir, prompt: 'do it' })
      const first = started.work[0]
      const body = 'evidence '.repeat(2_000)
      temp.complete(started.run.id, first.step_path, first.work_token, body)

      const zero = temp.next(started.run.id)[0]
      expect(zero.name).toBe('zero')
      expect(zero.context.inputs).toEqual([])
      expect(zero.context.artifacts).toEqual([])
      temp.complete(started.run.id, zero.step_path, zero.work_token, { summary: 'zero done' })

      const second = temp.next(started.run.id)[0]
      expect(second.name).toBe('second')
      expect(second.context.inputs).toHaveLength(1)
      expect(second.context.inputs[0]).toMatchObject({
        label: 'one',
        path: 'temp/1-first',
        name: 'first',
      })
      expect(second.context.inputs[0].result).toBe(body)
      expect(second.context).not.toHaveProperty('steps')
      expect(second.context.artifacts).toEqual([
        { label: 'spec.md', path: 'spec.md', exists: true },
        { label: 'missing.md', path: 'missing.md', exists: false },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('puts workspace model defaults on work orders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-runtime-models-'))
    try {
      mkdirSync(join(dir, 'orchestration'))
      writeFileSync(
        join(dir, 'orchestration', 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'defaults:',
          '  provider: workspace-provider',
          '  model: workspace-model',
          'imports:',
          '  std:',
          `    - path: ${join(workspace, 'lib', 'std', 'software')}`,
        ].join('\n')
      )
      const local = new Runtime({ store, configPath: join(dir, 'orchestration', 'index.yml') })
      local.registerAdapter({
        harness: 'opencode',
        workspace: dir,
        capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
      })
      const started = local.start({
        workspace: dir,
        prompt: 'build it',
        target: 'std:software/feature',
      })
      expect(started.work[0].provider).toBe('workspace-provider')
      expect(started.work[0].model).toBe('workspace-model')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('routes from a package entry router and records the decision', () => {
    adapter()
    const started = runtime.start({ workspace, prompt: 'a new feature', target: 'std:software' })
    expect(started.work[0].kind).toBe('router')
    expect(started.work[0].provider).toBe(defaults?.provider)
    expect(started.work[0].model).toBe(defaults?.model)
    expect(started.work[0].routes?.map((route) => route.when)).toEqual([
      'feature',
      'bug',
      'documentation',
    ])
    expect(started.work[0].prompt).toContain(
      '- `feature` — new capability or a substantial change.'
    )
    expect(started.work[0].prompt).not.toContain('[ROUTES]')
    expect(started.work[0].routes?.find((route) => route.when === 'feature')?.criteria).toBe(
      'new capability or a substantial change.'
    )
    const advanced = runtime.route(
      started.run.id,
      started.work[0].step_path,
      started.work[0].work_token,
      'feature'
    )
    expect(advanced.ready[0].name).toBe('create_spec')
  })

  it('runs the bug lifecycle through a regression test before the fix', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'fix the bug',
      target: 'std:software/bug',
    })
    expect(started.work[0].name).toBe('identify_bug')

    const completed = runtime.complete(
      started.run.id,
      started.work[0].step_path,
      started.work[0].work_token,
      { root_cause: 'missing guard' }
    )
    expect(completed.ready.map((step) => step.name)).toContain('write_regression_test')
    const next = runtime.next(started.run.id)
    expect(next[0].name).toBe('write_regression_test')
  })

  it('runs the documentation lifecycle in order', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'update the docs',
      target: 'std:software/docs',
    })
    expect(started.work[0].name).toBe('assess_docs')

    const completed = runtime.complete(
      started.run.id,
      started.work[0].step_path,
      started.work[0].work_token,
      { plan: 'rewrite orchestration.md' }
    )
    expect(completed.ready.map((step) => step.name)).toContain('update_docs')
    const next = runtime.next(started.run.id)
    expect(next[0].name).toBe('update_docs')
  })

  it('fails a step and retries it until the attempt limit', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    const failed = runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
    expect(failed.retry).toBe(true)
    const retry = runtime.next(started.run.id)[0]
    expect(retry.attempt).toBe(2)
  })

  it('keeps one attempt row per claim while steps stays a single projection row', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    runtime.fail(started.run.id, work.step_path, work.work_token, 'boom', {
      turns: 4,
      tokens: 10,
    })
    const first = store.stepAttempts(started.run.id, work.step_path)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      attempt: 1,
      status: 'retry',
      error: 'boom',
      turns: 4,
      tokens: 10,
    })
    expect(first[0].finished_at).toBeTruthy()

    const retry = runtime.next(started.run.id)[0]
    expect(retry.attempt).toBe(2)
    const attempts = store.stepAttempts(started.run.id, work.step_path)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({ attempt: 2, status: 'running', turns: 0, tokens: 0 })

    runtime.complete(
      started.run.id,
      retry.step_path,
      retry.work_token,
      { ok: true },
      {
        turns: 2,
        tokens: 50,
      }
    )
    const final = store.stepAttempts(started.run.id, work.step_path)
    expect(final[1]).toMatchObject({ attempt: 2, status: 'done', turns: 2, tokens: 50 })
    expect(JSON.parse(final[1].result ?? 'null')).toEqual({ ok: true })

    const projection = store.steps(started.run.id).filter((step) => step.path === work.step_path)
    expect(projection).toHaveLength(1)
    expect(projection[0].attempt).toBe(2)
    expect(projection[0].current_attempt_id).toBe(final[1].id)
  })

  it('links step events to the attempt that produced them', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
    const retry = runtime.next(started.run.id)[0]
    runtime.complete(started.run.id, retry.step_path, retry.work_token, 'ok')

    const attempts = store.stepAttempts(started.run.id, work.step_path)
    const events = store.events(started.run.id)
    expect(attempts).toHaveLength(2)
    expect(
      events.filter((event) => event.type === 'step.started').map((event) => event.attempt_id)
    ).toEqual(attempts.map((attempt) => attempt.id))
    expect(events.find((event) => event.type === 'step.retry')?.attempt_id).toBe(attempts[0].id)
    expect(events.find((event) => event.type === 'step.completed')?.attempt_id).toBe(attempts[1].id)
  })

  it('exposes attempt history for a run and rejects unknown steps', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    expect(runtime.attempts(started.run.id)).toHaveLength(1)
    expect(runtime.attempts(started.run.id, work.step_path)).toHaveLength(1)
    expect(store.stepAttempt(started.run.id, work.step_path, 1)?.status).toBe('running')
    expect(() => runtime.attempts(started.run.id, 'missing')).toThrow(/does not exist/)
  })

  it('runs background steps before the remaining foreground steps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-runtime-'))
    try {
      mkdirSync(join(dir, 'orchestration'))
      writeFileSync(
        join(dir, 'orchestration', 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: example',
          'pipelines:',
          '  example:',
          '    steps:',
          '      - name: task_1',
          '        type: task',
          '      - name: task_group',
          '        type: group',
          '        steps:',
          '          - name: background_task',
          '            type: task',
          '            background: true',
          '          - name: inline_task',
          '            type: task',
        ].join('\n')
      )
      const tempRuntime = new Runtime({
        store: new Store(':memory:'),
        configPath: join(dir, 'orchestration', 'index.yml'),
      })
      const started = tempRuntime.start({ workspace: dir, prompt: 'example', target: 'example' })
      const first = started.work[0]
      expect(first.name).toBe('task_1')
      tempRuntime.complete(started.run.id, first.step_path, first.work_token, 'ready')
      const background = tempRuntime.next(started.run.id)[0]
      expect(background.name).toBe('background_task')
      expect(background.background).toBe(true)
      tempRuntime.complete(started.run.id, background.step_path, background.work_token, 'risks')
      const inline = tempRuntime.next(started.run.id)[0]
      expect(inline.name).toBe('inline_task')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates spawned child runs and resumes the parent when they finish', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const parent = started.work[0]
    const spawned = runtime.spawn(started.run.id, parent.step_path, parent.work_token, {
      count: 2,
      prompt: 'check one file',
    })
    expect(spawned.children).toHaveLength(2)
    for (const child of spawned.children) {
      const work = runtime.next(child.id)[0]
      expect(work.provider).toBe(parent.provider)
      expect(work.model).toBe(parent.model)
      runtime.complete(child.id, work.step_path, work.work_token, 'ok')
    }
    const resumed = runtime.status(started.run.id)
    expect(resumed.run.state).not.toBe('failed')
    const next = runtime.next(started.run.id)[0]
    expect(next.name).toBe('build')
  })

  it('closes the parent attempt when a spawned run is cancelled', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const parent = started.work[0]
    runtime.spawn(started.run.id, parent.step_path, parent.work_token, {
      count: 1,
      prompt: 'check one file',
    })
    expect(store.stepAttempts(started.run.id, parent.step_path)[0].status).toBe('waiting_children')

    runtime.cancel(started.run.id, 'human')
    expect(store.step(started.run.id, parent.step_path)?.status).toBe('cancelled')
    expect(store.stepAttempts(started.run.id, parent.step_path)[0].status).toBe('cancelled')
  })

  it('requeues a stalled step on tick and opens an alert', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    const row = store.step(started.run.id, work.step_path)
    store.updateStep(Number(row?.id), {
      heartbeat_at: new Date(Date.now() - 120_000).toISOString(),
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    const ticked = runtime.tick()
    expect(ticked.alerts.length).toBeGreaterThan(0)
    expect(store.step(started.run.id, work.step_path)?.status).toBe('ready')
  })

  it('settles the whole step tree when a stalled step exhausts its retries', () => {
    adapter()
    const started = runtime.start({ workspace, prompt: 'build a feature', target: 'std:software' })
    const router = started.work[0]
    runtime.route(started.run.id, router.step_path, router.work_token, 'feature')

    let work = runtime.next(started.run.id)[0]
    runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
    work = runtime.next(started.run.id)[0]
    runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
    work = runtime.next(started.run.id)[0]

    const row = store.step(started.run.id, work.step_path)
    store.updateStep(Number(row?.id), {
      heartbeat_at: new Date(Date.now() - 600_000).toISOString(),
      lease_expires_at: new Date(Date.now() + 600_000).toISOString(),
    })

    runtime.tick()

    const run = store.run(started.run.id)
    expect(run?.state).toBe('failed')
    expect(run?.error).toBe('heartbeat stalled')
    const steps = store.steps(started.run.id)
    expect(steps.find((step) => step.path === router.step_path)?.status).toBe('done')
    expect(steps.find((step) => step.path === work.step_path)?.status).toBe('failed')
    expect(
      steps.filter((step) =>
        ['pending', 'ready', 'running', 'waiting_children'].includes(step.status)
      )
    ).toHaveLength(0)
    expect(
      steps.every((step) => ['skipped', 'cancelled', 'failed', 'done'].includes(step.status))
    ).toBe(true)
    expect(
      store.events(started.run.id).filter((event) => event.type === 'run.failed')
    ).toHaveLength(1)
    expect(store.stepAttempts(started.run.id, work.step_path)[2].status).toBe('failed')
    expect(() => runtime.complete(started.run.id, work.step_path, work.work_token, 'late')).toThrow(
      /is failed/
    )
  })

  it('fails a group when a later child is already failed', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const first = started.work[0]
    const later = store.steps(started.run.id).find((step) => step.name === 'build')
    expect(later).toBeTruthy()
    if (!later) return
    store.updateStep(Number(later.id), {
      status: 'failed',
      error: 'boom',
      finished_at: new Date().toISOString(),
    })

    runtime.advance(started.run.id)

    expect(store.run(started.run.id)?.state).toBe('failed')
    expect(store.step(started.run.id, first.step_path)?.status).toBe('cancelled')
    expect(store.step(started.run.id, later.path)?.status).toBe('failed')
  })

  it('settles interrupted work as cancelled and never-started work as skipped on cancel', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'build a feature',
      target: 'std:software/feature',
    })
    runtime.cancel(started.run.id, 'human')

    const steps = store.steps(started.run.id)
    expect(steps.find((step) => step.path === started.work[0].step_path)?.status).toBe('cancelled')
    expect(steps.filter((step) => step.status === 'skipped').length).toBeGreaterThan(0)
    expect(
      steps.every((step) => ['skipped', 'cancelled', 'failed', 'done'].includes(step.status))
    ).toBe(true)
  })

  it('requires all strict adapter capabilities', () => {
    runtime.registerAdapter({
      harness: 'opencode',
      workspace,
      capabilities: ['turn_limit'],
    })
    expect(() =>
      runtime.start({ workspace, prompt: 'build it', target: 'std:software/feature' })
    ).toThrow(/tool_policy/)
  })

  it('does not advance healthy running work on a watchdog tick', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    const ticked = runtime.tick()
    expect(ticked.alerts).toHaveLength(0)
    expect(store.step(started.run.id, work.step_path)?.status).toBe('running')
  })

  it('accepts the final usage update after a step completes', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    runtime.complete(started.run.id, work.step_path, work.work_token, { ok: true }, { turns: 1 })
    const updated = runtime.usage(started.run.id, work.step_path, work.work_token, {
      turns: 2,
      tokens: 250,
      toolCalls: 3,
    })
    expect(updated).toMatchObject({ status: 'done', turns: 2, tokens: 250, tool_calls: 3 })
    const attempt = store.stepAttempts(started.run.id, work.step_path)[0]
    expect(attempt).toMatchObject({ status: 'done', turns: 2, tokens: 250, tool_calls: 3 })
  })

  it('never lets a late usage update lower a completed total', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    runtime.complete(started.run.id, work.step_path, work.work_token, { ok: true }, { tokens: 250 })
    const updated = runtime.usage(started.run.id, work.step_path, work.work_token, { tokens: 200 })
    expect(updated.tokens).toBe(250)
  })

  it('rejects a late usage update from an old attempt or token', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const first = started.work[0]
    runtime.fail(started.run.id, first.step_path, first.work_token, 'boom')
    const second = runtime.next(started.run.id)[0]
    expect(() =>
      runtime.usage(started.run.id, first.step_path, first.work_token, { tokens: 10 })
    ).toThrow(/work token/)
    runtime.complete(started.run.id, second.step_path, second.work_token, { ok: true })
    expect(() =>
      runtime.usage(started.run.id, second.step_path, 'stale-token', { tokens: 10 })
    ).toThrow(/no longer accepts usage/)
  })

  it('requires the work token to renew a lease', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    expect(() => runtime.heartbeat(started.run.id, work.step_path, 'stale-token')).toThrow(
      /work token/
    )
    expect(() =>
      runtime.usage(started.run.id, work.step_path, 'stale-token', { turns: 1 })
    ).toThrow(/work token/)
    const beaten = runtime.heartbeat(started.run.id, work.step_path, work.work_token)
    expect(beaten.status).toBe('running')
    const reported = runtime.usage(started.run.id, work.step_path, work.work_token, {
      turns: 2,
    })
    expect(reported.turns).toBe(2)
  })

  it('rejects renewals from an abandoned attempt after a retry', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const first = started.work[0]
    const row = store.step(started.run.id, first.step_path)
    store.updateStep(Number(row?.id), {
      status: 'ready',
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    const second = runtime.next(started.run.id)[0]
    expect(second.work_token).not.toBe(first.work_token)
    expect(() => runtime.heartbeat(started.run.id, first.step_path, first.work_token)).toThrow(
      /work token/
    )
    expect(() =>
      runtime.usage(started.run.id, first.step_path, first.work_token, { turns: 1 })
    ).toThrow(/work token/)
    expect(runtime.heartbeat(started.run.id, second.step_path, second.work_token).status).toBe(
      'running'
    )
    const denied = runtime.check(
      started.run.id,
      first.step_path,
      { action: 'edit', tool: 'edit' },
      undefined,
      first.work_token
    )
    expect(denied.closed).toBe(true)
  })

  it('fails a spawned group fast and cancels its siblings', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const parent = started.work[0]
    const spawned = runtime.spawn(started.run.id, parent.step_path, parent.work_token, {
      count: 2,
      prompt: 'check one file',
    })
    const second = runtime.next(spawned.children[1].id)[0]
    for (let attempt = 0; attempt < 3; attempt++) {
      const work = runtime.next(spawned.children[0].id)[0]
      runtime.fail(spawned.children[0].id, work.step_path, work.work_token, 'boom')
    }
    runtime.advance(started.run.id)
    expect(store.run(spawned.children[0].id)?.state).toBe('failed')
    expect(store.run(spawned.children[1].id)?.state).toBe('cancelled')
    expect(store.step(started.run.id, parent.step_path)?.status).toBe('failed')
    expect(second.step_path).toBeTruthy()
  })

  it('accepts a completion that exceeded the reported budget without retrying', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    const advanced = runtime.complete(started.run.id, work.step_path, work.work_token, 'too much', {
      turns: work.budget.turns + 1,
      tokens: 0,
    })
    expect(advanced.ready.map((step) => step.name)).toEqual(['build'])
    const row = store.step(started.run.id, work.step_path)
    expect(row?.status).toBe('done')
    expect(row?.error).toBeNull()
    expect(JSON.parse(row?.result ?? 'null')).toBe('too much')
    expect(runtime.inbox().some((alert) => alert.kind === 'budget')).toBe(false)
    const attempts = store.stepAttempts(started.run.id, work.step_path)
    expect(attempts.map((attempt) => attempt.status)).toEqual(['done'])
    const completed = store
      .events(started.run.id)
      .find(
        (event) =>
          event.type === 'step.completed' && JSON.parse(event.payload).step === work.step_path
      )
    expect(JSON.parse(completed?.payload ?? '{}').over_budget).toBe('turn limit reached')
    expect(runtime.next(started.run.id)[0].name).toBe('build')
  })

  it('resets the live projection and attempt clock when a new attempt starts', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const work = started.work[0]
    const row = store.step(started.run.id, work.step_path)
    store.updateStep(Number(row?.id), {
      status: 'ready',
      result: '"stale"',
      error: 'stale error',
      finished_at: new Date().toISOString(),
      started_at: '2000-01-01T00:00:00.000Z',
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    const retry = runtime.next(started.run.id)[0]
    expect(retry.attempt).toBe(2)
    const reset = store.step(started.run.id, work.step_path)
    expect(reset?.result).toBeNull()
    expect(reset?.error).toBeNull()
    expect(reset?.finished_at).toBeNull()
    expect(reset?.started_at).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('evaluates policy and records violations', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'build a feature',
      target: 'std:software/feature',
    })
    const work = started.work[0]
    const denied = runtime.check(started.run.id, work.step_path, {
      action: 'edit',
      tool: 'edit',
      resources: ['.env'],
    })
    expect(denied.effect).toBe('deny')
    const allowed = runtime.check(started.run.id, work.step_path, {
      action: 'edit',
      tool: 'edit',
      resources: ['spec.md'],
    })
    expect(allowed.effect).toBe('allow')
  })

  it('routes prose requests to the content pipeline and exposes the run workspace', () => {
    const started = runtime.start({
      workspace,
      prompt: 'write a short article',
    })
    const router = started.work[0]
    expect(router.kind).toBe('router')
    expect(router.workspace).toBe(resolve(workspace))
    expect(router.routes?.map((route) => route.when)).toEqual([
      'rebuild',
      'content',
      'software-development',
      'research',
      'diagnostics',
    ])

    const advanced = runtime.route(started.run.id, router.step_path, router.work_token, 'content')
    expect(advanced.ready[0].path).toContain('route-content')
    expect(advanced.ready[0].name).toBe('brief')
  })

  it('records observed denials without blocking tools or counting violations', () => {
    const started = runtime.start({
      workspace,
      prompt: 'audit the orchestrator setup',
      target: 'std:diagnostics',
    })
    const work = started.work[0]
    const decision = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'shell', tool: 'shell', command: 'rm -rf /' },
      { turns: 0 }
    )
    expect(decision.effect).toBe('allow')
    expect(decision.reason).toContain('observed')
    expect(store.step(started.run.id, work.step_path)?.violations).toBe(0)
    expect(store.events(started.run.id).some((event) => event.type === 'policy.observed')).toBe(
      true
    )
  })

  it('denies an over-budget tool in observed mode but keeps control tools available', () => {
    const started = runtime.start({
      workspace,
      prompt: 'write a short article',
    })
    const work = started.work[0]
    const denied = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'read', tool: 'read' },
      { turns: 99 }
    )
    expect(denied.effect).toBe('deny')
    expect(denied.reason).toContain('budget exhausted')
    expect(denied.closed).toBe(false)
    expect(store.step(started.run.id, work.step_path)?.violations).toBe(0)

    // The budget is a resource cap, so it applies even when the step is
    // observed. A second denial does not duplicate the event.
    runtime.check(started.run.id, work.step_path, { action: 'read', tool: 'read' }, { turns: 99 })
    expect(
      store.events(started.run.id).filter((event) => event.type === 'budget.exhausted')
    ).toHaveLength(1)

    const routed = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'clara_route', tool: 'clara_route' },
      { turns: 99 }
    )
    expect(routed.effect).toBe('allow')
  })

  it('denies work tools once only the token reserve is left', () => {
    const started = runtime.start({
      workspace,
      prompt: 'write a short article',
    })
    const work = started.work[0]
    const reserve = reserveTokens(work.budget)
    const near = { tokens: work.budget.tokens - reserve }
    const denied = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'read', tool: 'read' },
      near
    )
    expect(denied.effect).toBe('deny')
    expect(denied.budgetExhausted).toBe('token reserve reached')
    expect(denied.reason).toContain('reserved for the final report')
    expect(
      store.events(started.run.id).filter((event) => event.type === 'budget.exhausted')
    ).toHaveLength(1)

    const completed = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'clara_complete', tool: 'clara_complete' },
      near
    )
    expect(completed.effect).toBe('allow')
  })

  it('retries a completion cut short by the budget and carries the handoff', () => {
    const temp = budgetRuntime({ attempts: 2, onExhausted: 'fail' })
    try {
      const started = temp.runtime.start({ workspace: temp.dir, prompt: 'fix it' })
      const work = started.work[0]
      const denied = temp.runtime.check(
        started.run.id,
        work.step_path,
        { action: 'read', tool: 'read' },
        { tokens: 1_000 }
      )
      expect(denied.budgetExhausted).toBe('token limit reached')

      const completed = temp.runtime.complete(
        started.run.id,
        work.step_path,
        work.work_token,
        { summary: 'root cause is in runtime.ts' },
        { tokens: 1_000 }
      )
      expect(completed.ready.map((step) => step.path)).toEqual([work.step_path])
      const retried = temp.store.step(started.run.id, work.step_path)
      expect(retried?.status).toBe('ready')
      expect(retried?.error).toContain('budget exhausted before the step finished')
      expect(temp.store.events(started.run.id).some((event) => event.type === 'step.retry')).toBe(
        true
      )

      const next = temp.runtime.next(started.run.id)[0]
      expect(next.attempt).toBe(2)
      expect(next.retry?.attempt).toBe(1)
      expect(next.retry?.result).toEqual({ summary: 'root cause is in runtime.ts' })
      expect(next.retry?.error).toContain('handoff')

      // The retry did not run out of budget, so its completion is final.
      temp.runtime.complete(started.run.id, next.step_path, next.work_token, { summary: 'fixed' })
      expect(temp.store.step(started.run.id, work.step_path)?.status).toBe('done')
    } finally {
      rmSync(temp.dir, { recursive: true, force: true })
    }
  })

  it('fails the last attempt when the budget cut the step short', () => {
    const temp = budgetRuntime({ attempts: 1, onExhausted: 'fail' })
    try {
      const started = temp.runtime.start({ workspace: temp.dir, prompt: 'fix it' })
      const work = started.work[0]
      temp.runtime.check(
        started.run.id,
        work.step_path,
        { action: 'read', tool: 'read' },
        { tokens: 1_000 }
      )
      temp.runtime.complete(started.run.id, work.step_path, work.work_token, {
        summary: 'partial handoff',
      })
      expect(temp.store.step(started.run.id, work.step_path)?.status).toBe('failed')
      expect(temp.store.run(started.run.id)?.state).toBe('failed')
      expect(temp.runtime.inbox().filter((alert) => alert.kind === 'failure')).toHaveLength(1)
    } finally {
      rmSync(temp.dir, { recursive: true, force: true })
    }
  })

  it('keeps an exhausted completion when the step opts out', () => {
    const temp = budgetRuntime({ attempts: 2, onExhausted: 'keep' })
    try {
      const started = temp.runtime.start({ workspace: temp.dir, prompt: 'fix it' })
      const work = started.work[0]
      temp.runtime.check(
        started.run.id,
        work.step_path,
        { action: 'read', tool: 'read' },
        { tokens: 1_000 }
      )
      temp.runtime.complete(
        started.run.id,
        work.step_path,
        work.work_token,
        {
          summary: 'kept result',
        },
        { tokens: 1_000 }
      )
      expect(temp.store.step(started.run.id, work.step_path)?.status).toBe('done')
      const completed = temp.store
        .events(started.run.id)
        .find((event) => event.type === 'step.completed')
      expect(JSON.parse(completed?.payload ?? '{}').over_budget).toBe('token limit reached')
    } finally {
      rmSync(temp.dir, { recursive: true, force: true })
    }
  })

  it('enforces the cache-weighted budget when the harness reports one', () => {
    const started = runtime.start({
      workspace,
      prompt: 'write a short article',
    })
    const work = started.work[0]
    // Raw usage looks exhausted, but the cache-weighted total is small.
    const allowed = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'read', tool: 'read' },
      { tokens: 999_999, budgetTokens: 500 }
    )
    expect(allowed.effect).toBe('allow')

    // The reverse: raw usage looks fine, the weighted total is over budget.
    const denied = runtime.check(
      started.run.id,
      work.step_path,
      { action: 'read', tool: 'read' },
      { tokens: 10, budgetTokens: work.budget.tokens + 1 }
    )
    expect(denied.effect).toBe('deny')
    expect(denied.budgetExhausted).toBe('token limit reached')
  })

  it('retries a strict step after the violation limit and resets usage for the next attempt', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'build a feature',
      target: 'std:software/feature',
    })
    const work = started.work[0]
    for (let index = 0; index < 3; index++) {
      const decision = runtime.check(
        started.run.id,
        work.step_path,
        { action: 'shell', tool: 'shell', command: 'rm -rf /' },
        { turns: 0 }
      )
      expect(decision.effect).toBe('deny')
    }

    const after = store.step(started.run.id, work.step_path)
    expect(after?.status).toBe('ready')
    expect(after?.violations).toBe(3)
    expect(
      store.events(started.run.id).filter((event) => event.type === 'policy.denied')
    ).toHaveLength(3)
    expect(store.events(started.run.id).some((event) => event.type === 'step.retry')).toBe(true)

    const retry = runtime.next(started.run.id)[0]
    expect(retry.attempt).toBe(2)
    const reset = store.step(started.run.id, work.step_path)
    expect(reset?.violations).toBe(0)
    expect(reset?.turns).toBe(0)
  })

  it('fails a strict step after all violation retries and opens one alert', () => {
    adapter()
    const started = runtime.start({
      workspace,
      prompt: 'build a feature',
      target: 'std:software/feature',
    })
    const path = started.work[0].step_path
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let index = 0; index < 3; index++) {
        runtime.check(
          started.run.id,
          path,
          { action: 'shell', tool: 'shell', command: 'rm -rf /' },
          { turns: 0 }
        )
      }
      if (attempt < 2) {
        expect(runtime.next(started.run.id)[0].attempt).toBe(attempt + 2)
      }
    }
    const row = store.step(started.run.id, path)
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('violation limit reached')
    expect(runtime.inbox().filter((alert) => alert.kind === 'failure')).toHaveLength(1)
  })

  it('lets a strict one-turn router use its turn and keeps clara_route after the budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-turn-'))
    try {
      mkdirSync(join(dir, 'orchestration', 'routers'), { recursive: true })
      writeFileSync(
        join(dir, 'orchestration', 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry:',
          '  router: classifier',
          'router:',
          '  id: classifier',
          '  path: ./routers/classifier.md',
          '  routes:',
          '    - when: work',
          '      criteria: any work',
          '      run: work',
          'pipelines:',
          '  work:',
          '    enforcement: strict',
          '    steps:',
          '      - name: do_work',
          '        type: task',
        ].join('\n')
      )
      writeFileSync(
        join(dir, 'orchestration', 'routers', 'classifier.md'),
        [
          '---',
          'strategy: llm_classify',
          'enforcement: strict',
          'limits:',
          '  turns:',
          '    initial: 1',
          '    absolute_max: 2',
          '---',
          '',
          '# Router',
          '',
          '[ROUTES]',
          '',
          'Call `clara_route`.',
        ].join('\n')
      )

      const temp = new Runtime({
        store: new Store(':memory:'),
        configPath: join(dir, 'orchestration', 'index.yml'),
      })
      temp.registerAdapter({
        harness: 'opencode',
        workspace: dir,
        capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
      })
      const started = temp.start({ workspace: dir, prompt: 'do work' })
      const work = started.work[0]
      expect(work.kind).toBe('router')
      expect(work.enforcement).toBe('strict')
      expect(work.budget.turns).toBe(1)
      // The first turn is usable even when the budget is one.
      expect(
        temp.check(started.run.id, work.step_path, { action: 'read', tool: 'read' }, { turns: 1 })
          .effect
      ).toBe('allow')
      // The next turn is over budget, but the route control tool still works.
      expect(
        temp.check(started.run.id, work.step_path, { action: 'read', tool: 'read' }, { turns: 2 })
          .effect
      ).toBe('deny')
      expect(
        temp.check(
          started.run.id,
          work.step_path,
          { action: 'clara_route', tool: 'clara_route' },
          { turns: 2 }
        ).effect
      ).toBe('allow')

      const advanced = temp.route(started.run.id, work.step_path, work.work_token, 'work')
      expect(advanced.ready[0].name).toBe('do_work')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not re-emit run.failed or rewrite finished_at for a terminal run', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    let work = started.work[0]
    for (let attempt = 0; attempt < 3; attempt++) {
      runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
      const next = runtime.next(started.run.id)[0]
      if (next) work = next
    }

    const failed = store.run(started.run.id)
    expect(failed?.state).toBe('failed')
    const events = store.events(started.run.id)
    const before = events.length
    const failures = events.filter((event) => event.type === 'run.failed').length
    expect(failures).toBe(1)

    runtime.status(started.run.id)
    runtime.status(started.run.id)
    runtime.next(started.run.id)
    runtime.tick()

    expect(store.events(started.run.id)).toHaveLength(before)
    expect(
      store.events(started.run.id).filter((event) => event.type === 'run.failed')
    ).toHaveLength(failures)
    expect(store.run(started.run.id)?.finished_at).toBe(failed?.finished_at)
  })

  it('claims a terminal delivery once across adapter instances', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    expect(runtime.claimDelivery(started.run.id, { terminal: true })).toEqual({
      terminal: false,
      alerts: [],
    })

    store.updateRun(started.run.id, {
      state: 'completed',
      finished_at: new Date().toISOString(),
    })

    expect(runtime.claimDelivery(started.run.id, { terminal: true })).toEqual({
      terminal: true,
      alerts: [],
    })
    expect(runtime.claimDelivery(started.run.id, { terminal: true })).toEqual({
      terminal: false,
      alerts: [],
    })

    runtime.releaseDelivery(started.run.id, { terminal: true })
    expect(runtime.claimDelivery(started.run.id, { terminal: true })).toEqual({
      terminal: true,
      alerts: [],
    })
  })

  it('claims each delivery alert once and releases only the named ids', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const first = store.alert({
      run_id: started.run.id,
      step_path: null,
      kind: 'failure',
      title: 'First',
      body: 'boom',
    })
    const second = store.alert({
      run_id: started.run.id,
      step_path: null,
      kind: 'failure',
      title: 'Second',
      body: 'boom',
    })

    expect(runtime.claimDelivery(started.run.id, { alert_ids: [first.id, second.id] })).toEqual({
      terminal: false,
      alerts: [first.id, second.id],
    })
    expect(runtime.claimDelivery(started.run.id, { alert_ids: [first.id, second.id] })).toEqual({
      terminal: false,
      alerts: [],
    })

    runtime.releaseDelivery(started.run.id, { alert_ids: [first.id] })
    expect(runtime.claimDelivery(started.run.id, { alert_ids: [first.id, second.id] })).toEqual({
      terminal: false,
      alerts: [first.id],
    })
  })

  it('does not claim an alert that belongs to another run', () => {
    const one = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const two = runtime.start({ workspace, prompt: 'patch', target: 'std:maintenance/rebuild' })
    const alert = store.alert({
      run_id: two.run.id,
      step_path: null,
      kind: 'failure',
      title: 'Other',
      body: 'boom',
    })

    expect(runtime.claimDelivery(one.run.id, { alert_ids: [alert.id] })).toEqual({
      terminal: false,
      alerts: [],
    })
    expect(runtime.claimDelivery(two.run.id, { alert_ids: [alert.id] })).toEqual({
      terminal: false,
      alerts: [alert.id],
    })
  })

  it('keeps delivery claims across a store reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-delivery-claims-'))
    const path = join(dir, 'orchestration.db')
    try {
      const firstStore = new Store(path)
      const firstRuntime = new Runtime({
        store: firstStore,
        configPath: `${workspace}/orchestration/index.yml`,
      })
      const started = firstRuntime.start({
        workspace,
        prompt: 'patch',
        target: 'std:maintenance/rebuild',
      })
      firstStore.updateRun(started.run.id, {
        state: 'completed',
        finished_at: new Date().toISOString(),
      })
      expect(firstRuntime.claimDelivery(started.run.id, { terminal: true })).toEqual({
        terminal: true,
        alerts: [],
      })
      firstStore.db.close()

      const secondStore = new Store(path)
      const secondRuntime = new Runtime({
        store: secondStore,
        configPath: `${workspace}/orchestration/index.yml`,
      })
      expect(secondRuntime.claimDelivery(started.run.id, { terminal: true })).toEqual({
        terminal: false,
        alerts: [],
      })
      secondStore.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
