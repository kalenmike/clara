import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRun, compileWrapperRun, loadCatalog, Runtime, Store } from '../src/index.ts'

function write(dir: string, path: string, content: string): void {
  const target = join(dir, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function wrapperFixture(options: { wrap?: string; workspaceFrom?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-wrapper-'))
  write(
    dir,
    'guard/index.yml',
    [
      'id: guard',
      'name: Guard',
      'version: 1',
      'wrappers:',
      '  guard:',
      `    workspace: { from: ${options.workspaceFrom ?? 'start'} }`,
      '    before:',
      '      - name: start',
      '        type: script',
      '        command: "true"',
      '        result_mode: json',
      '    after:',
      '      - name: check',
      '        type: script',
      '        command: "true"',
      '    cleanup:',
      '      - name: stop',
      '        type: script',
      '        command: "true"',
    ].join('\n')
  )
  write(
    dir,
    'worker/index.yml',
    [
      'id: worker',
      'name: Worker',
      'version: 1',
      'entry:',
      '  router: choose',
      'pipelines:',
      '  one:',
      '    steps:',
      '      - name: work',
      '        type: script',
      '        command: "true"',
      '  two:',
      '    steps:',
      '      - name: work',
      '        type: script',
      '        command: "true"',
      'router:',
      '  id: choose',
      '  routes:',
      '    - when: one',
      '      run: one',
      '    - when: two',
      '      run: two',
    ].join('\n')
  )
  write(
    dir,
    'root/index.yml',
    [
      'id: root',
      'name: Root',
      'version: 1',
      'imports:',
      '  g:',
      '    - path: ../guard',
      '  ext:',
      '    - path: ../worker',
      `      wrap: ${options.wrap ?? 'g:guard'}`,
      'entry:',
      '  router: classify',
      'router:',
      '  id: classify',
      '  routes:',
      '    - when: package',
      '      run: ext:worker',
      '    - when: pipeline',
      '      run: ext:worker/one',
    ].join('\n')
  )
  return { dir, config: join(dir, 'root', 'index.yml') }
}

describe('pipeline wrappers', () => {
  it('wraps a route target from another package and leaves its own routes alone', () => {
    const { dir, config } = wrapperFixture()
    try {
      const catalog = loadCatalog(config)
      const run = compileRun(catalog)
      const packageRoute = run.root.routes?.find((route) => route.when === 'package')?.target
      expect(packageRoute?.kind).toBe('group')
      expect(packageRoute?.name).toBe('wrapper:guard')
      expect(packageRoute?.children?.map((child) => child.name)).toEqual(['start', 'work', 'stop'])

      const work = packageRoute?.children?.find((child) => child.name === 'work')
      expect(work?.workspace).toMatchObject({ field: 'path' })
      expect(work?.workspace?.path).toMatch(/1-start$/)
      const body = work?.children?.[0]
      expect(body?.kind).toBe('router')
      expect(body?.routes?.map((route) => route.target?.name)).toEqual(['one', 'two'])
      expect(body?.scopePath).toBe(work?.path)

      const pipelineRoute = run.root.routes?.find((route) => route.when === 'pipeline')?.target
      expect(pipelineRoute?.name).toBe('wrapper:guard')
      const pipelineBody = pipelineRoute?.children?.find((child) => child.name === 'work')
        ?.children?.[0]
      expect(pipelineBody?.kind).toBe('pipeline')

      // Explicit operator targets are not wrapped; the guard is a router boundary.
      expect(compileRun(catalog, 'ext:worker').root.kind).toBe('router')
      expect(compileRun(catalog, 'ext:worker/one').root.kind).toBe('pipeline')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compiles a wrapper on its own with a preview slot', () => {
    const { dir, config } = wrapperFixture()
    try {
      const run = compileWrapperRun(loadCatalog(config), 'g:guard')
      expect(run.root.name).toBe('wrapper:guard')
      expect(run.root.children?.map((child) => child.name)).toEqual(['start', 'work', 'stop'])
      const work = run.root.children?.find((child) => child.name === 'work')
      expect(work?.children?.map((child) => child.name)).toEqual(['wrapped', 'check'])
      expect(work?.children?.[0]).toMatchObject({
        kind: 'pipeline',
        title: 'Wrapped pipeline',
        slot: true,
      })
      expect(work?.workspace?.path).toMatch(/1-start$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a wrapper reference that is not imported', () => {
    const { dir, config } = wrapperFixture({ wrap: 'g:guard/missing' })
    try {
      expect(() => compileRun(loadCatalog(config))).toThrow(/wrapper not found/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a workspace binding that does not name a before step', () => {
    const { dir, config } = wrapperFixture({ workspaceFrom: 'nope' })
    try {
      expect(() => compileRun(loadCatalog(config))).toThrow(/must name one before step/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs the wrapped pipeline in the resolved worktree', () => {
    const { dir, config } = wrapperFixture()
    const workspace = join(dir, 'repo')
    const scope = join(dir, 'clara-worktrees', 'run-1')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(scope, { recursive: true })
    writeFileSync(join(scope, '.git'), 'gitdir: /tmp/fake-worktree\n')
    writeFileSync(join(scope, 'marker.txt'), 'ok')
    try {
      // The wrapped body declares the artifact the work order should resolve.
      write(
        dir,
        'worker/index.yml',
        [
          'id: worker',
          'name: Worker',
          'version: 1',
          'entry:',
          '  pipeline: one',
          'pipelines:',
          '  one:',
          '    steps:',
          '      - name: work',
          '        type: script',
          '        command: "true"',
          '        artifacts:',
          '          marker: marker.txt',
        ].join('\n')
      )
      const store = new Store(':memory:')
      const runtime = new Runtime({ store, configPath: config })
      const started = runtime.start({ workspace, prompt: 'do the work' })
      const route = started.work[0]
      runtime.complete(started.run.id, route.step_path, route.work_token, { route: 'package' })

      const start = runtime.next(started.run.id)[0]
      expect(start.workspace).toBe(workspace)
      expect(start.name).toBe('start')

      runtime.complete(started.run.id, start.step_path, start.work_token, { path: scope })
      const work = runtime.next(started.run.id)[0]
      expect(work.name).toBe('work')
      expect(work.workspace).toBe(realpathSync(scope))
      expect(work.context.artifacts).toEqual([
        { label: 'marker', path: 'marker.txt', exists: true },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails the scope when the resolved workspace does not exist', () => {
    const { dir, config } = wrapperFixture()
    const workspace = join(dir, 'repo')
    mkdirSync(workspace, { recursive: true })
    try {
      const store = new Store(':memory:')
      const runtime = new Runtime({ store, configPath: config })
      const started = runtime.start({ workspace, prompt: 'do the work' })
      const route = started.work[0]
      runtime.complete(started.run.id, route.step_path, route.work_token, { route: 'package' })
      const start = runtime.next(started.run.id)[0]
      runtime.complete(started.run.id, start.step_path, start.work_token, {
        path: join(dir, 'missing'),
      })
      expect(runtime.next(started.run.id)).toEqual([])
      const run = store.run(started.run.id)
      expect(run?.state).toBe('failed')
      expect(run?.error).toMatch(/does not exist/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
