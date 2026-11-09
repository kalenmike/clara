import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogSummary, compileRun, loadCatalog } from '../src/index.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const config = `${root}/orchestration/index.yml`

describe('package loader', () => {
  it('discovers the std software package and primary pipelines', () => {
    const catalog = loadCatalog(config)
    const summary = catalogSummary(catalog)
    expect(summary.map((pkg) => pkg.id)).toContain('orchestration')
    const software = summary.find((pkg) => pkg.id === 'software')
    expect(software?.pipelines).toEqual(['bug', 'docs', 'feature'])
    expect(software?.routers).toContain('classifier')
  })

  it('compiles the package entry router and a named pipeline', () => {
    const catalog = loadCatalog(config)
    const entry = compileRun(catalog, 'std:software')
    expect(entry.root.kind).toBe('router')
    expect(entry.root.routes?.map((route) => route.when)).toEqual([
      'feature',
      'bug',
      'documentation',
    ])
    // The workspace defaults apply to imported packages; the package itself
    // does not pin a model.
    expect(entry.root.provider).toBe('opencode-go')
    expect(entry.root.model).toBe('deepseek-v4.1-flash')
    expect(entry.root.declared ?? []).not.toContain('provider')
    expect(entry.root.declared ?? []).not.toContain('model')

    const feature = compileRun(catalog, 'std:software/feature')
    expect(feature.root.kind).toBe('pipeline')
    expect(feature.root.children?.map((step) => step.name)).toEqual([
      'create_spec',
      'plan_implementation',
      'write_tests',
      'build_feature',
      'verify_implementation',
      'code_review',
      'update_docs',
    ])
    expect(feature.root.children?.[0].policy?.rules?.[0].effect).toBe('deny')
    expect(feature.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(feature.root.packageId).toBe('software')
    expect(feature.root.provider).toBe('opencode-go')
    expect(feature.root.model).toBe('deepseek-v4.1-flash')
    expect(feature.root.declared).toEqual(expect.arrayContaining(['enforcement']))
    const first = feature.root.children?.[0]
    expect(first?.packageId).toBe('software')
    expect(first?.task).toBe('create_spec')
    expect(first?.promptSource).toBe('task')
    expect(first?.provider).toBe('opencode-go')
    expect(first?.model).toBe('deepseek-v4.1-flash')
    expect(first?.source).toContain('/tasks/create_spec.md')
  })

  it('treats the root package id as its entry', () => {
    const catalog = loadCatalog(config)
    const entry = compileRun(catalog)
    const named = compileRun(catalog, 'orchestration')
    expect(named.root).toEqual(entry.root)
    expect(named.hash).toBe(entry.hash)
  })

  it('resolves provider and model through manifest, pipeline, and step overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-models-'))
    try {
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: main',
          'defaults:',
          '  provider: manifest-provider',
          '  model: manifest-model',
          'pipelines:',
          '  main:',
          '    default_provider: pipeline-provider',
          '    default_model: pipeline-model',
          '    steps:',
          '      - name: inherit',
          '        type: task',
          '        prompt: do it',
          '      - name: override',
          '        type: task',
          '        prompt: do it',
          '        provider: step-provider',
          '        model: step-model',
          '      - name: model_only',
          '        type: task',
          '        prompt: do it',
          '        model: step-model-only',
          '  manifest:',
          '    steps:',
          '      - name: inherit',
          '        type: task',
          '        prompt: do it',
        ].join('\n')
      )
      const catalog = loadCatalog(dir)
      const main = compileRun(catalog, 'main')
      const inherit = main.root.children?.find((step) => step.name === 'inherit')
      const override = main.root.children?.find((step) => step.name === 'override')
      const modelOnly = main.root.children?.find((step) => step.name === 'model_only')
      expect(inherit?.provider).toBe('pipeline-provider')
      expect(inherit?.model).toBe('pipeline-model')
      expect(override?.provider).toBe('step-provider')
      expect(override?.model).toBe('step-model')
      expect(modelOnly?.provider).toBe('pipeline-provider')
      expect(modelOnly?.model).toBe('step-model-only')

      const manifest = compileRun(catalog, 'manifest')
      expect(manifest.root.provider).toBe('manifest-provider')
      expect(manifest.root.model).toBe('manifest-model')
      expect(manifest.root.children?.[0].provider).toBe('manifest-provider')
      expect(manifest.root.children?.[0].model).toBe('manifest-model')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps standard packages free of model and provider defaults', () => {
    const catalog = loadCatalog(config)
    const stdRoot = join(root, 'lib', 'std')
    const std = catalog.packages.filter((pkg) => pkg.dir.startsWith(stdRoot))
    expect(std.length).toBeGreaterThan(0)
    for (const pkg of std) {
      expect(pkg.manifest.defaults?.model).toBeUndefined()
      expect(pkg.manifest.defaults?.provider).toBeUndefined()
      for (const pipeline of pkg.pipelines.values()) {
        expect(pipeline.default_model).toBeUndefined()
        expect(pipeline.default_provider).toBeUndefined()
      }
      for (const task of pkg.tasks.values()) {
        expect(task.model).toBeUndefined()
        expect(task.provider).toBeUndefined()
      }
    }
  })

  it('inherits workspace defaults across imported packages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-workspace-defaults-'))
    try {
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'defaults:',
          '  model: workspace-model',
          '  provider: workspace-provider',
          'imports:',
          '  std:',
          `    - path: ${join(root, 'lib', 'std', 'software')}`,
        ].join('\n')
      )
      const catalog = loadCatalog(dir)
      const entry = compileRun(catalog, 'std:software')
      expect(entry.root.model).toBe('workspace-model')
      expect(entry.root.provider).toBe('workspace-provider')

      const feature = compileRun(catalog, 'std:software/feature')
      expect(feature.root.model).toBe('workspace-model')
      expect(feature.root.provider).toBe('workspace-provider')
      const first = feature.root.children?.[0]
      expect(first?.model).toBe('workspace-model')
      expect(first?.provider).toBe('workspace-provider')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves step, pipeline, task, package, and workspace model order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-precedence-'))
    try {
      const pkg = join(dir, 'pkg')
      mkdirSync(join(pkg, 'tasks'), { recursive: true })
      writeFileSync(
        join(pkg, 'index.yml'),
        [
          'id: pkg',
          'name: Pkg',
          'version: 1',
          'defaults:',
          '  model: package-model',
          '  provider: package-provider',
          'pipelines:',
          '  main:',
          '    steps:',
          '      - name: plain',
          '        type: task',
          '        prompt: do it',
          '      - name: custom',
          '        type: task',
          '        task: thing',
          '  with_default:',
          '    default_model: pipeline-model',
          '    default_provider: pipeline-provider',
          '    steps:',
          '      - name: plain',
          '        type: task',
          '        prompt: do it',
          '      - name: custom',
          '        type: task',
          '        task: thing',
          '  explicit:',
          '    steps:',
          '      - name: explicit',
          '        type: task',
          '        prompt: do it',
          '        model: step-model',
          '        provider: step-provider',
        ].join('\n')
      )
      writeFileSync(
        join(pkg, 'tasks', 'thing.md'),
        ['---', 'model: task-model', 'provider: task-provider', '---', 'Do the thing.'].join('\n')
      )
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'defaults:',
          '  model: workspace-model',
          '  provider: workspace-provider',
          'imports:',
          '  x:',
          '    - path: ./pkg',
        ].join('\n')
      )
      const catalog = loadCatalog(dir)
      const main = compileRun(catalog, 'x:pkg/main')
      const plain = main.root.children?.find((step) => step.name === 'plain')
      const custom = main.root.children?.find((step) => step.name === 'custom')
      expect(plain?.model).toBe('package-model')
      expect(plain?.provider).toBe('package-provider')
      expect(custom?.model).toBe('task-model')
      expect(custom?.provider).toBe('task-provider')

      const withDefault = compileRun(catalog, 'x:pkg/with_default')
      const pipelinePlain = withDefault.root.children?.find((step) => step.name === 'plain')
      const pipelineCustom = withDefault.root.children?.find((step) => step.name === 'custom')
      expect(pipelinePlain?.model).toBe('pipeline-model')
      expect(pipelineCustom?.model).toBe('pipeline-model')

      const explicit = compileRun(catalog, 'x:pkg/explicit')
      expect(explicit.root.children?.[0].model).toBe('step-model')
      expect(explicit.root.children?.[0].provider).toBe('step-provider')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies workspace overrides to imported packages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-overrides-'))
    try {
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'defaults:',
          '  model: workspace-model',
          '  provider: workspace-provider',
          'overrides:',
          '  std:software:',
          '    defaults:',
          '      model: override-model',
          '      provider: override-provider',
          '    pipelines:',
          '      feature:',
          '        default_model: feature-model',
          '        default_provider: feature-provider',
          '    tasks:',
          '      identify_bug:',
          '        model: task-model',
          '        provider: task-provider',
          'imports:',
          '  std:',
          `    - path: ${join(root, 'lib', 'std', 'software')}`,
        ].join('\n')
      )
      const catalog = loadCatalog(dir)

      const feature = compileRun(catalog, 'std:software/feature')
      expect(feature.root.model).toBe('feature-model')
      expect(feature.root.provider).toBe('feature-provider')
      const spec = feature.root.children?.find((step) => step.name === 'create_spec')
      expect(spec?.model).toBe('feature-model')
      expect(spec?.provider).toBe('feature-provider')

      const bug = compileRun(catalog, 'std:software/bug')
      expect(bug.root.model).toBe('override-model')
      expect(bug.root.provider).toBe('override-provider')
      const identify = bug.root.children?.find((step) => step.name === 'identify_bug')
      expect(identify?.model).toBe('task-model')
      expect(identify?.provider).toBe('task-provider')
      const fix = bug.root.children?.find((step) => step.name === 'fix_bug')
      expect(fix?.model).toBe('override-model')
      expect(fix?.provider).toBe('override-provider')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unknown or malformed overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-bad-overrides-'))
    try {
      const write = (overrides: string[]): void => {
        writeFileSync(
          join(dir, 'index.yml'),
          [
            'id: temp',
            'name: Temp',
            'version: 1',
            'imports:',
            '  std:',
            `    - path: ${join(root, 'lib', 'std', 'software')}`,
            'overrides:',
            ...overrides,
          ].join('\n')
        )
      }

      write(['  std:missing:', '    defaults:', '      model: m'])
      expect(() => loadCatalog(dir)).toThrow(/unknown package import/)

      write(['  std:software:', '    pipelines:', '      missing:', '        default_model: m'])
      expect(() => loadCatalog(dir)).toThrow(/pipeline not found/)

      write(['  std:software:', '    tasks:', '      missing:', '        model: m'])
      expect(() => loadCatalog(dir)).toThrow(/task not found/)

      write(['  std:software:', '    defaults:', '      provder: m'])
      expect(() => loadCatalog(dir)).toThrow(/provder is not supported/)

      write(['  std:software:', '    defaults:', '      model: ""'])
      expect(() => loadCatalog(dir)).toThrow(/must be a non-empty string/)

      write(['  software:', '    defaults:', '      model: m'])
      expect(() => loadCatalog(dir)).toThrow(/must be namespace:package/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compiles the bug lifecycle from reproduction to verification', () => {
    const catalog = loadCatalog(config)
    const bug = compileRun(catalog, 'std:software/bug')
    expect(bug.root.kind).toBe('pipeline')
    expect(bug.root.children?.map((step) => step.name)).toEqual([
      'identify_bug',
      'write_regression_test',
      'fix_bug',
      'verify_bug_fix',
      'code_review',
      'update_docs',
    ])
  })

  it('gives the bug lifecycle retry growth and fail-on-exhausted budgets', () => {
    const catalog = loadCatalog(config)
    const bug = compileRun(catalog, 'std:software/bug')
    const children = bug.root.children ?? []
    expect(children).toHaveLength(6)
    for (const step of children) {
      expect(step.limits?.on_exhausted).toBe('fail')
      expect(step.limits?.tokens?.growth_rate).toBeGreaterThan(1)
      expect(step.retries?.auto_attempts).toBeGreaterThan(1)
    }
    const fix = children.find((step) => step.name === 'fix_bug')
    expect(fix?.limits?.tokens?.initial).toBe(120_000)
    expect(fix?.limits?.tokens?.absolute_max).toBe(360_000)
    expect(fix?.retries?.auto_attempts).toBe(3)
  })

  it('compiles the documentation lifecycle', () => {
    const catalog = loadCatalog(config)
    const docs = compileRun(catalog, 'std:software/docs')
    expect(docs.root.kind).toBe('pipeline')
    expect(docs.root.enforcement).toBe('strict')
    expect(docs.root.children?.map((step) => step.name)).toEqual([
      'assess_docs',
      'update_docs',
      'verify_docs',
      'docs_review',
    ])
  })

  it('resolves a task for every task step in the software package', () => {
    const catalog = loadCatalog(config)
    const software = catalog.packages.find((pkg) => pkg.manifest.id === 'software')
    expect(software).toBeDefined()
    for (const pipeline of software!.pipelines.values()) {
      for (const step of pipeline.steps) {
        if (step.type !== 'task') continue
        const task = software!.tasks.get(step.task ?? step.name)
        expect(task, `${pipeline.id}/${step.name} has no task`).toBeDefined()
        expect(
          task?.prompt.trim().length,
          `${pipeline.id}/${step.name} has an empty prompt`
        ).toBeGreaterThan(0)
      }
    }
  })

  it('injects route criteria into router prompts', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    expect(primary.root.prompt).toContain(
      '- `software-development` — a normal software feature, bug, or documentation request.'
    )
    expect(primary.root.prompt).not.toContain('[ROUTES]')

    const software = compileRun(catalog, 'std:software')
    const feature = software.root.routes?.find((route) => route.when === 'feature')
    expect(feature?.criteria).toBe('new capability or a substantial change.')
    expect(software.root.prompt).toContain('- `feature` — new capability or a substantial change.')
    expect(software.root.prompt).not.toContain('[ROUTES]')
  })

  it('appends routes when the router prompt has no placeholder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-router-'))
    try {
      mkdirSync(join(dir, 'routers'))
      writeFileSync(
        join(dir, 'index.yml'),
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
          '    - when: one',
          '      criteria: first option.',
          '      run: one',
          'pipelines:',
          '  one:',
          '    steps:',
          '      - name: do_it',
          '        type: task',
        ].join('\n')
      )
      writeFileSync(join(dir, 'routers', 'classifier.md'), '# Temp router\n\nPick one.')
      const run = compileRun(loadCatalog(dir))
      expect(run.root.kind).toBe('router')
      expect(run.root.prompt).toContain('## Routes')
      expect(run.root.prompt).toContain('- `one` — first option.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compiles a local pipeline and fails closed on a missing import', () => {
    const catalog = loadCatalog(config)
    expect(compileRun(catalog, 'quick_patch').root.kind).toBe('pipeline')
    expect(() => compileRun(catalog, 'std:missing')).toThrow(/unknown import/)
  })

  it('keeps nested groups and router targets in the snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-nested-'))
    try {
      mkdirSync(join(dir, 'routers'))
      writeFileSync(
        join(dir, 'index.yml'),
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
          '      - name: task_router',
          '        type: router',
          '        path: ./routers/example.md',
          '  feature:',
          '    steps:',
          '      - name: do_feature',
          '        type: task',
        ].join('\n')
      )
      writeFileSync(
        join(dir, 'routers', 'example.md'),
        [
          '---',
          'routes:',
          '  - when: feature',
          '    criteria: new work.',
          '    run: feature',
          '---',
          '# Example router',
          '[ROUTES]',
        ].join('\n')
      )
      const example = compileRun(loadCatalog(dir))
      const group = example.root.children?.find((step) => step.name === 'task_group')
      expect(group?.kind).toBe('group')
      expect(group?.children?.length).toBe(2)
      const router = example.root.children?.find((step) => step.name === 'task_router')
      expect(router?.kind).toBe('router')
      expect(router?.routes?.every((route) => route.target)).toBe(true)
      expect(router?.prompt).toContain('- `feature` — new work.')
      expect(router?.prompt).not.toContain('[ROUTES]')
      expect(example.snapshot).toContain('background_task')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads the content package', () => {
    const catalog = loadCatalog(config)
    const content = compileRun(catalog, 'std:content', new Set())
    expect(content.root.kind).toBe('pipeline')
    expect(content.root.children?.map((step) => step.name)).toEqual([
      'brief',
      'draft',
      'edit',
      'deliver',
    ])
  })

  it('loads the research package', () => {
    const catalog = loadCatalog(config)
    const research = compileRun(catalog, 'std:research')
    expect(research.root.kind).toBe('pipeline')
    expect(research.root.children?.map((step) => step.name)).toEqual([
      'scope_research',
      'gather_sources',
      'verify_sources',
      'draft_report',
      'review_report',
      'deliver_report',
    ])

    const gather = research.root.children?.find((step) => step.name === 'gather_sources')
    expect(gather?.prompt).toContain('live external web search')
    const verify = research.root.children?.find((step) => step.name === 'verify_sources')
    expect(verify?.prompt).toContain('at least three independent sources')
    const report = research.root.children?.find((step) => step.name === 'draft_report')
    expect(report?.prompt).toContain('## Executive summary')
    expect(report?.prompt).toContain('Pull, do not push')
  })

  it('routes research requests from the primary classifier', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    const route = primary.root.routes?.find((candidate) => candidate.when === 'research')
    expect(route?.run).toBe('std:research')
    expect(route?.criteria).toContain('external research')
  })

  it('loads the diagnostics package', () => {
    const catalog = loadCatalog(config)
    const diagnostics = compileRun(catalog, 'std:diagnostics')
    expect(diagnostics.root.kind).toBe('pipeline')
    expect(diagnostics.root.children?.map((step) => step.name)).toEqual([
      'collect_evidence',
      'pattern_failures',
      'audit_setup',
      'rank_issues',
      'propose_fixes',
      'review_report',
    ])
    const collect = diagnostics.root.children?.find((step) => step.name === 'collect_evidence')
    expect(collect?.prompt).toContain('pnpm clara orchestration analyze')
    expect(collect?.promptSource).toBe('task')
    const audit = diagnostics.root.children?.find((step) => step.name === 'audit_setup')
    expect(audit?.limits?.turns).toEqual({
      initial: 36,
      growth_rate: 4,
      absolute_max: 48,
    })
    expect(diagnostics.root.enforcement).toBe('observed')
  })

  it('routes diagnostics requests from the primary classifier', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    const route = primary.root.routes?.find((candidate) => candidate.when === 'diagnostics')
    expect(route?.run).toBe('std:diagnostics')
    expect(route?.criteria).toContain('self-analyze the orchestrator')
  })

  it('loads the maintenance package', () => {
    const catalog = loadCatalog(config)
    const maintenance = compileRun(catalog, 'std:maintenance')
    expect(maintenance.root.kind).toBe('pipeline')
    expect(maintenance.root.children?.map((step) => step.name)).toEqual([
      'capture_setup',
      'build',
      'install_adapters',
      'restart_services',
      'verify_health',
    ])
    expect(maintenance.root.enforcement).toBe('observed')
    expect(maintenance.root.children?.every((step) => step.promptSource === 'task')).toBe(true)
    const capture = maintenance.root.children?.find((step) => step.name === 'capture_setup')
    expect(capture?.prompt).toContain('pnpm clara rebuild status --json')
    const restart = maintenance.root.children?.find((step) => step.name === 'restart_services')
    expect(restart?.limits?.wall_clock_seconds).toBe(900)
  })

  it('routes explicit rebuild requests from the primary classifier', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    const route = primary.root.routes?.find((candidate) => candidate.when === 'rebuild')
    expect(route?.run).toBe('std:maintenance')
    expect(route?.criteria).toContain('explicit request to rebuild Clara')
  })
})
