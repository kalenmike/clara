import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Runtime, Store } from '../src/index.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(options: {
  steps: string[]
  enforcement?: string
  agents?: Record<string, string>
  scripts?: Record<string, string>
}): { dir: string; runtime: Runtime; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), 'clara-script-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'orchestration'), { recursive: true })
  if (options.agents) mkdirSync(join(dir, 'orchestration', 'agents'), { recursive: true })
  if (options.scripts) mkdirSync(join(dir, 'orchestration', 'scripts'), { recursive: true })
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
      ...(options.enforcement ? [`    enforcement: ${options.enforcement}`] : []),
      '    steps:',
      ...options.steps,
    ].join('\n')
  )
  for (const [name, body] of Object.entries(options.agents ?? {})) {
    writeFileSync(join(dir, 'orchestration', 'agents', `${name}.md`), body)
  }
  for (const [name, body] of Object.entries(options.scripts ?? {})) {
    writeFileSync(join(dir, 'orchestration', 'scripts', `${name}.yml`), body)
  }
  const store = new Store(':memory:')
  const runtime = new Runtime({
    store,
    configPath: join(dir, 'orchestration', 'index.yml'),
    runnerWaitMs: 0,
  })
  return { dir, runtime, store }
}

describe('script steps', () => {
  it('compiles an inline script into a work order without a model or prompt', () => {
    const { dir, runtime } = fixture({
      steps: [
        '      - name: build',
        '        type: script',
        '        command: echo ready',
        '        result_mode: text',
        '        timeout_seconds: 30',
      ],
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    expect(started.work).toHaveLength(1)
    const work = started.work[0]
    expect(work.kind).toBe('script')
    expect(work.script).toEqual({
      command: 'echo ready',
      resultMode: 'text',
      timeoutSeconds: 30,
    })
    expect(work.prompt).toBeUndefined()
    expect(work.model).toBeUndefined()
    expect(work.provider).toBeUndefined()
    expect(work.budget).toBeUndefined()
    expect(work.max_attempts).toBe(1)
  })

  it('resolves a named script asset', () => {
    const { dir, runtime } = fixture({
      steps: ['      - name: build', '        type: script', '        script: build'],
      scripts: {
        build: ['command: pnpm build', 'result_mode: json', 'timeout_seconds: 120'].join('\n'),
      },
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    expect(started.work[0].script).toEqual({
      command: 'pnpm build',
      resultMode: 'json',
      timeoutSeconds: 120,
    })
  })

  it('passes the script result to the next agent through inputs', () => {
    const { dir, runtime } = fixture({
      steps: [
        '      - name: collect',
        '        type: script',
        '        command: echo evidence',
        '      - name: interpret',
        '        type: agent',
        '        inputs:',
        '          evidence: collect',
      ],
      agents: {
        interpret: ['---', 'description: interpret', '---', 'Interpret the evidence.'].join('\n'),
      },
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    const script = started.work[0]
    runtime.complete(started.run.id, script.step_path, script.work_token, { found: 2 })
    const next = runtime.next(started.run.id)[0]
    expect(next.kind).toBe('agent')
    expect(next.context.inputs).toEqual([
      { label: 'evidence', path: script.step_path, name: 'collect', result: { found: 2 } },
    ])
  })

  it('leaves script work for a runner when the start caller cannot run scripts', () => {
    const { dir, runtime } = fixture({
      steps: ['      - name: build', '        type: script', '        command: echo ready'],
    })
    const started = runtime.start({
      workspace: dir,
      prompt: 'go',
      capabilities: ['agent'],
    })
    expect(started.work).toEqual([])
    const claimed = runtime.claimWork(dir, { capabilities: ['script'] }, 1, 'runner')
    expect(claimed).toHaveLength(1)
    expect(claimed[0].kind).toBe('script')
  })

  it('filters work by advertised capability', () => {
    const { dir, runtime, store } = fixture({
      steps: [
        '      - name: build',
        '        type: script',
        '        command: echo ready',
        '      - name: review',
        '        type: agent',
        '        prompt: review it',
      ],
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    const first = started.work[0]
    expect(first.kind).toBe('script')
    runtime.complete(started.run.id, first.step_path, first.work_token, 'ok')
    expect(runtime.next(started.run.id, 1, 'script-only', { capabilities: ['script'] })).toEqual([])
    const agent = runtime.next(started.run.id, 1, 'agent-only', { capabilities: ['agent'] })[0]
    expect(agent.kind).toBe('agent')
    expect(store.step(started.run.id, agent.step_path)?.status).toBe('running')
  })

  it('opens a no_runner alert when a script step is ready with no runner', () => {
    const { dir, runtime } = fixture({
      steps: [
        '      - name: prepare',
        '        type: agent',
        '        prompt: prepare it',
        '      - name: build',
        '        type: script',
        '        command: echo ready',
      ],
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    const prepare = started.work[0]
    runtime.complete(started.run.id, prepare.step_path, prepare.work_token, 'ok')
    const ticked = runtime.tick()
    expect(ticked.alerts.some((alert) => alert.kind === 'no_runner')).toBe(true)
  })

  it('requires a live runner for a strict script pipeline', () => {
    const { dir, runtime } = fixture({
      enforcement: 'strict',
      steps: ['      - name: build', '        type: script', '        command: echo ready'],
    })
    expect(() => runtime.start({ workspace: dir, prompt: 'go' })).toThrow(/runner with script/)
    runtime.registerAdapter({
      harness: 'clara-runner',
      role: 'runner',
      workspace: dir,
      capabilities: ['script'],
    })
    const started = runtime.start({ workspace: dir, prompt: 'go' })
    expect(started.work[0].kind).toBe('script')
  })

  it('shares script work across harness origins with one runner', () => {
    const { dir, runtime } = fixture({
      steps: ['      - name: build', '        type: script', '        command: echo ready'],
    })
    runtime.start({ workspace: dir, prompt: 'opencode work', origin: { harness: 'opencode' } })
    runtime.start({ workspace: dir, prompt: 'claude work', origin: { harness: 'claudecode' } })
    const claimed = runtime.claimWork(
      dir,
      { capabilities: ['script'], role: 'runner' },
      2,
      'runner'
    )
    expect(claimed).toHaveLength(2)
    expect(claimed.every((order) => order.kind === 'script')).toBe(true)
  })

  it('does not let a runner claim agent work or a harness claim script work', () => {
    const { dir, runtime } = fixture({
      steps: ['      - name: review', '        type: agent', '        prompt: review it'],
    })
    const started = runtime.start({ workspace: dir, prompt: 'go', capabilities: ['script'] })
    expect(
      runtime.next(started.run.id, 1, 'runner', {
        capabilities: ['agent'],
        role: 'runner',
      })
    ).toEqual([])
    expect(
      runtime.next(started.run.id, 1, 'harness', {
        capabilities: ['agent'],
        role: 'harness',
        harness: 'opencode',
      })
    ).toHaveLength(1)

    const script = fixture({
      steps: ['      - name: build', '        type: script', '        command: echo ready'],
    })
    const scriptRun = script.runtime.start({
      workspace: script.dir,
      prompt: 'go',
      capabilities: ['agent'],
      origin: { harness: 'opencode' },
    })
    expect(
      script.runtime.next(scriptRun.run.id, 1, 'harness', {
        capabilities: ['script'],
        role: 'harness',
        harness: 'opencode',
      })
    ).toEqual([])
  })

  it('rejects prompt on a script step', () => {
    const { dir, runtime } = fixture({
      steps: [
        '      - name: build',
        '        type: script',
        '        command: echo ready',
        '        prompt: explain',
      ],
    })
    expect(() => runtime.start({ workspace: dir, prompt: 'go' })).toThrow(/prompt is not supported/)
  })
})
