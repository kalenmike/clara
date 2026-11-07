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
})
