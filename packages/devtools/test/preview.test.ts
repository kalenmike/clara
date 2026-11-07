import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CompiledNode } from '@clara/orchestration/types'
import {
  collectSources,
  diffCompiled,
  inspectSnapshot,
  previewPipeline,
  resolveWorkspace,
} from '../src/index.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const config = join(root, 'orchestration', 'index.yml')

describe('pipeline preview', () => {
  it('discovers root and imported targets', () => {
    const result = previewPipeline({ workspace: root })
    const refs = result.targets.map((target) => target.ref)
    expect(refs).toContain('')
    expect(refs).toContain('quick_patch')
    expect(refs).toContain('std:software')
    expect(refs).toContain('std:software/feature')
    expect(refs).toContain('std:content/content')
    expect(result.catalog?.packages.map((pkg) => pkg.id)).toContain('software')
  })

  it('compiles a named pipeline with rendered prompts and sources', () => {
    const result = previewPipeline({ workspace: root, target: 'std:software/feature' })
    expect(result.selected?.ref).toBe('std:software/feature')
    expect(result.compiled?.root.kind).toBe('pipeline')
    const names = result.compiled?.root.children?.map((step) => step.name) ?? []
    expect(names[0]).toBe('create_spec')
    expect(names).toContain('write_tests')
    expect(names).toContain('code_review')
    expect(names).toContain('update_docs')
    expect(result.stats?.tasks).toBe(names.length)
    expect(result.stats?.nodes).toBe(names.length + 1)
    expect(result.compiled?.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([])
    const first = result.compiled?.root.children?.[0]
    expect(first?.promptSource).toBe('task')
    expect(first?.task).toBe('create_spec')
    expect(first?.source).toContain('/tasks/create_spec.md')
    expect(result.sources.some((source) => source.kind === 'task')).toBe(true)
    expect(result.sources.some((source) => source.kind === 'config')).toBe(true)
  })

  it('renders router routes and compiles their branches', () => {
    const result = previewPipeline({ workspace: root, target: 'std:software' })
    expect(result.compiled?.root.kind).toBe('router')
    const routes = result.compiled?.root.routes?.map((route) => route.when) ?? []
    expect(routes).toContain('feature')
    expect(routes).toContain('bug')
    expect(result.compiled?.root.prompt).toContain('`feature` —')
    expect(result.compiled?.root.routes?.every((route) => route.target)).toBe(true)
  })

  it('reports compile failures with a diagnostic', () => {
    const result = previewPipeline({ workspace: root, target: 'std:missing' })
    expect(result.compiled).toBeUndefined()
    expect(
      result.diagnostics.some(
        (entry) => entry.severity === 'error' && entry.code === 'compile_failed'
      )
    ).toBe(true)
  })

  it('warns about generated prompts and routes without criteria', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-devtools-'))
    try {
      mkdirSync(join(dir, 'pipelines'))
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry:',
          '  pipeline: main',
          'pipelines:',
          '  main:',
          '    steps:',
          '      - name: missing_task',
          '      - name: choose',
          '        type: router',
          '        routes:',
          '          - when: go',
          '            run: other',
          '  other:',
          '    steps:',
          '      - name: do_it',
          '        task: not_there',
        ].join('\n')
      )
      const result = previewPipeline({ workspace: dir })
      const codes = result.diagnostics.map((entry) => entry.code)
      expect(codes).toContain('task_prompt_fallback')
      expect(codes).toContain('route_without_criteria')
      const main = result.compiled?.root
      expect(main?.children?.[0].promptSource).toBe('fallback')
      expect(main?.children?.[0].source).toContain('index.yml')
      expect(main?.children?.[1].routes?.[0].target?.name).toBe('other')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('collects and classifies source files', () => {
    const result = previewPipeline({ workspace: root, target: 'std:software/feature' })
    const sources = collectSources(
      {
        root: {
          manifest: { id: 'x', name: 'x', version: 1, imports: {}, source: config },
          dir: root,
          pipelines: new Map(),
          routers: new Map(),
          tasks: new Map(),
          imports: new Map(),
          entry: {},
          sources: [config],
        },
        packages: [],
        configPath: config,
      },
      undefined
    )
    expect(sources).toHaveLength(1)
    expect(sources[0].kind).toBe('config')
    expect(result.sources.length).toBeGreaterThan(3)
  })
})

describe('workspace resolution', () => {
  it('accepts a workspace directory and an index file', () => {
    expect(resolveWorkspace({ workspace: root }).configPath).toBe(config)
    expect(resolveWorkspace({ workspace: config }).workspace).toBe(root.slice(0, -1))
  })

  it('fails with a clear error when no config exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-devtools-empty-'))
    try {
      expect(() => resolveWorkspace({ workspace: dir })).toThrow(/No orchestration config/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('compiled diff', () => {
  it('reports changed fields and added or removed nodes', () => {
    const result = previewPipeline({ workspace: root, target: 'quick_patch' })
    const current = result.compiled?.root as CompiledNode
    const pinned = structuredClone(current)
    const child = pinned.children?.[0]
    expect(child).toBeTruthy()
    if (child) child.prompt = 'old prompt'
    if (pinned.children) pinned.children = pinned.children.slice(0, 1)

    const diff = diffCompiled(current, pinned)
    expect(diff.summary.changed).toBeGreaterThan(0)
    expect(diff.summary.added).toBeGreaterThan(0)
    expect(
      diff.changes.some((change) => change.fields.some((field) => field.field === 'prompt'))
    ).toBe(true)
  })

  it('inspects both run snapshots and compile snapshots', () => {
    const result = previewPipeline({ workspace: root, target: 'quick_patch' })
    const rootNode = result.compiled?.root as CompiledNode
    expect(inspectSnapshot(JSON.stringify(rootNode)).path).toBe(rootNode.path)
    expect(
      inspectSnapshot(JSON.stringify({ root: rootNode, sources: [], packages: [] })).path
    ).toBe(rootNode.path)
    expect(() => inspectSnapshot('{}')).toThrow(/compiled step tree/)
  })
})
