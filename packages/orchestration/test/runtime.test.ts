import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { Runtime, Store } from '../src/index.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
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

  it('routes from a package entry router and records the decision', () => {
    adapter()
    const started = runtime.start({ workspace, prompt: 'a new feature', target: 'std:software' })
    expect(started.work[0].kind).toBe('router')
    expect(started.work[0].routes?.map((route) => route.when)).toEqual([
      'feature',
      'bug',
      'example',
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

  it('fails a step and retries it until the attempt limit', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
    const work = started.work[0]
    const failed = runtime.fail(started.run.id, work.step_path, work.work_token, 'boom')
    expect(failed.retry).toBe(true)
    const retry = runtime.next(started.run.id)[0]
    expect(retry.attempt).toBe(2)
  })

  it('runs background steps before the remaining foreground steps', () => {
    const started = runtime.start({ workspace, prompt: 'example', target: 'std:software/example' })
    const first = started.work[0]
    expect(first.name).toBe('task_1')
    runtime.complete(started.run.id, first.step_path, first.work_token, 'ready')
    const background = runtime.next(started.run.id)[0]
    expect(background.name).toBe('background_task')
    expect(background.background).toBe(true)
    runtime.complete(started.run.id, background.step_path, background.work_token, 'risks')
    const inline = runtime.next(started.run.id)[0]
    expect(inline.name).toBe('inline_task')
  })

  it('creates spawned child runs and resumes the parent when they finish', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
    const parent = started.work[0]
    const spawned = runtime.spawn(started.run.id, parent.step_path, parent.work_token, {
      count: 2,
      prompt: 'check one file',
    })
    expect(spawned.children).toHaveLength(2)
    for (const child of spawned.children) {
      const work = runtime.next(child.id)[0]
      runtime.complete(child.id, work.step_path, work.work_token, 'ok')
    }
    const resumed = runtime.status(started.run.id)
    expect(resumed.run.state).not.toBe('failed')
    const next = runtime.next(started.run.id)[0]
    expect(next.name).toBe('quick_verify')
  })

  it('requeues a stalled step on tick and opens an alert', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
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
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
    const work = started.work[0]
    const ticked = runtime.tick()
    expect(ticked.alerts).toHaveLength(0)
    expect(store.step(started.run.id, work.step_path)?.status).toBe('running')
  })

  it('fails a spawned group fast and cancels its siblings', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
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

  it('retries a completion that exceeded the reported budget', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
    let work = started.work[0]
    for (let attempt = 0; attempt < 3; attempt++) {
      runtime.complete(started.run.id, work.step_path, work.work_token, 'too much', {
        turns: 99,
        tokens: 999_999,
      })
      const next = runtime.next(started.run.id)[0]
      if (next) work = next
    }
    expect(store.step(started.run.id, started.work[0].step_path)?.status).toBe('failed')
    expect(runtime.inbox().some((alert) => alert.kind === 'budget')).toBe(true)
  })

  it('evaluates policy and records violations', () => {
    const started = runtime.start({ workspace, prompt: 'patch', target: 'quick_patch' })
    const work = started.work[0]
    const denied = runtime.check(started.run.id, work.step_path, {
      action: 'edit',
      tool: 'edit',
      resources: ['README.md'],
    })
    expect(denied.effect).toBe('deny')
    const allowed = runtime.check(started.run.id, work.step_path, {
      action: 'edit',
      tool: 'edit',
      resources: ['src/app.ts'],
    })
    expect(allowed.effect).toBe('allow')
  })
})
