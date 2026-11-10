import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogSummary, compileRun, loadCatalog } from '../src/index.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const config = `${root}/orchestration/index.yml`

function pipelinePackage(steps: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-wiring-'))
  writeFileSync(
    join(dir, 'index.yml'),
    [
      'id: temp',
      'name: Temp',
      'version: 1',
      'entry: main',
      'pipelines:',
      '  main:',
      '    steps:',
      ...steps,
    ].join('\n')
  )
  return dir
}

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
    const defaults = catalog.root.manifest.defaults
    const entry = compileRun(catalog, 'std:software')
    expect(entry.root.kind).toBe('router')
    expect(entry.root.routes?.map((route) => route.when)).toEqual([
      'feature',
      'bug',
      'documentation',
    ])
    expect(entry.root.provider).toBe(defaults?.provider)
    expect(entry.root.model).toBe(defaults?.model)

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
    expect(feature.root.provider).toBe(defaults?.provider)
    expect(feature.root.model).toBe(defaults?.model)
    expect(feature.root.declared).toEqual(expect.arrayContaining(['enforcement']))
    const first = feature.root.children?.[0]
    expect(first?.packageId).toBe('software')
    expect(first?.agent).toBe('create_spec')
    expect(first?.promptSource).toBe('agent')
    expect(first?.provider).toBe(defaults?.provider)
    expect(first?.model).toBe(defaults?.model)
    expect(first?.source).toContain('/agents/create_spec.md')
  })

  it('compiles a bounded on_failure recovery branch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-recovery-'))
    try {
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: main',
          'pipelines:',
          '  main:',
          '    steps:',
          '      - name: primary',
          '        type: script',
          '        command: pnpm test --json',
          '        on_failure:',
          '          max_cycles: 2',
          '          retry: false',
          '          steps:',
          '            - name: fix',
          '              type: script',
          '              command: pnpm fix --json',
        ].join('\n')
      )
      const catalog = loadCatalog(join(dir, 'index.yml'))
      const run = compileRun(catalog, 'main')
      const primary = run.root.children?.[0]
      expect(primary?.onFailure?.maxCycles).toBe(2)
      expect(primary?.onFailure?.retry).toBe(false)
      expect(primary?.onFailure?.children.map((child) => child.name)).toEqual(['fix'])
      expect(primary?.onFailure?.children[0].path).toBe(`${primary?.path}/on_failure/1-fix`)
      expect(primary?.onFailure?.children[0].recoveryFor).toBe(primary?.path)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid on_failure declarations', () => {
    const cases = [
      ['max_cycles: 4', /between 1 and 3/],
      ['max_cycles: 1\n          steps: []', /at least one step/],
    ]
    for (const [body, message] of cases) {
      const dir = mkdtempSync(join(tmpdir(), 'clara-recovery-bad-'))
      try {
        writeFileSync(
          join(dir, 'index.yml'),
          [
            'id: temp',
            'name: Temp',
            'version: 1',
            'entry: main',
            'pipelines:',
            '  main:',
            '    steps:',
            '      - name: primary',
            '        type: script',
            '        command: pnpm test --json',
            '        on_failure:',
            `          ${body}`,
          ].join('\n')
        )
        expect(() => compileRun(loadCatalog(join(dir, 'index.yml')), 'main')).toThrow(message)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('falls back the package entry when select filters it', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'clara-select-pkg-'))
    const root = mkdtempSync(join(tmpdir(), 'clara-select-root-'))
    try {
      writeFileSync(
        join(pkg, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: keep',
          'pipelines:',
          '  keep:',
          '    steps:',
          '      - name: keep_step',
          '        type: script',
          '        command: echo keep',
          '  other:',
          '    steps:',
          '      - name: other_step',
          '        type: script',
          '        command: echo other',
        ].join('\n')
      )
      writeFileSync(
        join(root, 'index.yml'),
        [
          'id: root',
          'name: Root',
          'version: 1',
          'imports:',
          '  temp:',
          '    - path: ' + pkg,
          '      select: [other]',
        ].join('\n')
      )
      const run = compileRun(loadCatalog(join(root, 'index.yml')), 'temp:temp')
      expect(run.root.children?.map((child) => child.name)).toEqual(['other_step'])
    } finally {
      rmSync(pkg, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
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
          '        type: agent',
          '        prompt: do it',
          '      - name: override',
          '        type: agent',
          '        prompt: do it',
          '        provider: step-provider',
          '        model: step-model',
          '      - name: model_only',
          '        type: agent',
          '        prompt: do it',
          '        model: step-model-only',
          '  manifest:',
          '    steps:',
          '      - name: inherit',
          '        type: agent',
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
      for (const task of pkg.agents.values()) {
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

  it('resolves step, pipeline, agent, package, and workspace model order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-precedence-'))
    try {
      const pkg = join(dir, 'pkg')
      mkdirSync(join(pkg, 'agents'), { recursive: true })
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
          '        type: agent',
          '        prompt: do it',
          '      - name: custom',
          '        type: agent',
          '        agent: thing',
          '  with_default:',
          '    default_model: pipeline-model',
          '    default_provider: pipeline-provider',
          '    steps:',
          '      - name: plain',
          '        type: agent',
          '        prompt: do it',
          '      - name: custom',
          '        type: agent',
          '        agent: thing',
          '  explicit:',
          '    steps:',
          '      - name: explicit',
          '        type: agent',
          '        prompt: do it',
          '        model: step-model',
          '        provider: step-provider',
        ].join('\n')
      )
      writeFileSync(
        join(pkg, 'agents', 'thing.md'),
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
          '    agents:',
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

      write(['  std:software:', '    agents:', '      missing:', '        model: m'])
      expect(() => loadCatalog(dir)).toThrow(/agent not found/)

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
    expect(fix?.limits?.turns).toEqual({
      initial: 100,
      growth_rate: 50,
      absolute_max: 150,
    })
    expect(fix?.limits?.tokens?.initial).toBe(1_500_000)
    expect(fix?.limits?.tokens?.absolute_max).toBe(2_000_000)
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

  it('resolves an agent for every agent step in the software package', () => {
    const catalog = loadCatalog(config)
    const software = catalog.packages.find((pkg) => pkg.manifest.id === 'software')
    expect(software).toBeDefined()
    for (const pipeline of software!.pipelines.values()) {
      for (const step of pipeline.steps) {
        if (step.type !== 'agent') continue
        const agent = software!.agents.get(step.agent ?? step.name)
        expect(agent, `${pipeline.id}/${step.name} has no agent`).toBeDefined()
        expect(
          agent?.prompt.trim().length,
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
          '        type: agent',
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

  it('compiles a pipeline and fails closed on a missing import', () => {
    const catalog = loadCatalog(config)
    expect(compileRun(catalog, 'std:maintenance/rebuild').root.kind).toBe('pipeline')
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
          '        type: agent',
          '      - name: task_group',
          '        type: group',
          '        steps:',
          '          - name: background_task',
          '            type: agent',
          '            background: true',
          '          - name: inline_task',
          '            type: agent',
          '      - name: task_router',
          '        type: router',
          '        path: ./routers/example.md',
          '  feature:',
          '    steps:',
          '      - name: do_feature',
          '        type: agent',
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
    const brief = content.root.children?.find((step) => step.name === 'brief')
    expect(brief?.limits?.turns).toEqual({
      initial: 100,
      growth_rate: 50,
      absolute_max: 150,
    })
    expect(brief?.limits?.tokens?.initial).toBe(1_500_000)
    expect(brief?.limits?.tokens?.absolute_max).toBe(2_000_000)
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
    expect(collect?.kind).toBe('script')
    expect(collect?.script?.command).toContain('pnpm clara orchestration analyze')
    const audit = diagnostics.root.children?.find((step) => step.name === 'audit_setup')
    expect(audit?.limits?.turns).toEqual({
      initial: 100,
      growth_rate: 50,
      absolute_max: 150,
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

  it('resolves list and mapping inputs to compiled step paths', () => {
    const dir = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '      - name: second',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          one: first',
      '        artifacts:',
      '          spec: spec.md',
      '        request: false',
      '      - name: third',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          - first',
      '          - second',
    ])
    try {
      const main = compileRun(loadCatalog(dir), 'main')
      const second = main.root.children?.find((step) => step.name === 'second')
      const third = main.root.children?.find((step) => step.name === 'third')
      expect(second?.inputs).toEqual({ one: 'main/1-first' })
      expect(second?.artifacts).toEqual({ spec: 'spec.md' })
      expect(second?.request).toBe(false)
      expect(second?.declared).toEqual(expect.arrayContaining(['inputs', 'artifacts', 'request']))
      expect(third?.inputs).toEqual({
        first: 'main/1-first',
        second: 'main/2-second',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves inputs inside router route targets', () => {
    const dir = pipelinePackage([])
    try {
      writeFileSync(
        join(dir, 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: main',
          'pipelines:',
          '  main:',
          '    steps:',
          '      - name: classify',
          '        type: router',
          '        routes:',
          '          - when: a',
          '            run: branch',
          '  branch:',
          '    steps:',
          '      - name: first',
          '        type: agent',
          '        prompt: do it',
          '      - name: second',
          '        type: agent',
          '        prompt: do it',
          '        inputs:',
          '          one: first',
        ].join('\n')
      )
      const main = compileRun(loadCatalog(dir), 'main')
      const branch = main.root.children?.[0].routes?.[0].target
      expect(branch?.children?.[1].inputs).toEqual({
        one: 'main/1-classify/route-a/1-first',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an unknown input with the available step names', () => {
    const dir = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '      - name: second',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          missing: create_spec',
    ])
    try {
      expect(() => compileRun(loadCatalog(dir), 'main')).toThrow(
        /inputs\.missing: step "create_spec" is not in this pipeline \(available: first\)/
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects forward and self references', () => {
    const forward = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          later: second',
      '      - name: second',
      '        type: agent',
      '        prompt: do it',
    ])
    try {
      expect(() => compileRun(loadCatalog(forward), 'main')).toThrow(/comes later in the pipeline/)
    } finally {
      rmSync(forward, { recursive: true, force: true })
    }

    const self = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          self: first',
    ])
    try {
      expect(() => compileRun(loadCatalog(self), 'main')).toThrow(/cannot reference itself/)
    } finally {
      rmSync(self, { recursive: true, force: true })
    }
  })

  it('rejects a background input', () => {
    const dir = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '        background: true',
      '      - name: second',
      '        type: agent',
      '        prompt: do it',
      '        inputs:',
      '          bg: first',
    ])
    try {
      expect(() => compileRun(loadCatalog(dir), 'main')).toThrow(/is background/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects duplicate step names and escaping artifacts', () => {
    const duplicate = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
    ])
    try {
      expect(() => compileRun(loadCatalog(duplicate), 'main')).toThrow(/duplicate step name/)
    } finally {
      rmSync(duplicate, { recursive: true, force: true })
    }

    const escape = pipelinePackage([
      '      - name: first',
      '        type: agent',
      '        prompt: do it',
      '        artifacts:',
      '          - ../secret.md',
    ])
    try {
      expect(() => compileRun(loadCatalog(escape), 'main')).toThrow(/workspace-relative path/)
    } finally {
      rmSync(escape, { recursive: true, force: true })
    }
  })

  it('loads the maintenance package as deterministic scripts', () => {
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
    expect(maintenance.root.children?.every((step) => step.kind === 'script')).toBe(true)
    const capture = maintenance.root.children?.find((step) => step.name === 'capture_setup')
    expect(capture?.script?.command).toContain('pnpm clara rebuild status --json')
    const build = maintenance.root.children?.find((step) => step.name === 'build')
    expect(build?.script?.command).toContain('pnpm clara rebuild build --json')
    const restart = maintenance.root.children?.find((step) => step.name === 'restart_services')
    expect(restart?.script?.timeoutSeconds).toBe(900)
    expect(restart?.retries?.auto_attempts).toBe(2)
    expect(restart?.onFailure?.retry).toBe(true)
    expect(restart?.onFailure?.children.map((step) => step.name)).toEqual(['recover_services'])
    expect(restart?.onFailure?.children[0].script?.command).toContain('pnpm clara rebuild recover')
    const health = maintenance.root.children?.find((step) => step.name === 'verify_health')
    expect(health?.onFailure?.maxCycles).toBe(1)
  })

  it('compiles the maintenance recover and diagnose pipelines', () => {
    const catalog = loadCatalog(config)
    const recover = compileRun(catalog, 'std:maintenance/recover')
    expect(recover.root.children?.map((step) => step.name)).toEqual([
      'inspect_setup',
      'recover_services',
      'verify_health',
    ])
    expect(recover.root.children?.every((step) => step.kind === 'script')).toBe(true)

    const diagnose = compileRun(catalog, 'std:maintenance/diagnose')
    expect(diagnose.root.children?.map((step) => step.name)).toEqual([
      'collect_run',
      'collect_setup',
      'classify_failure',
      'review_diagnosis',
    ])
    expect(
      diagnose.root.children?.find((step) => step.name === 'collect_setup')?.script?.successCodes
    ).toEqual([0, 1])
    expect(diagnose.root.children?.find((step) => step.name === 'classify_failure')?.kind).toBe(
      'agent'
    )
  })

  it('routes explicit rebuild requests from the primary classifier', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    const route = primary.root.routes?.find((candidate) => candidate.when === 'rebuild')
    expect(route?.run).toBe('std:maintenance')
    expect(route?.criteria).toContain('explicit request to rebuild Clara')
  })
})
