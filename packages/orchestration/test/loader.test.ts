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
    expect(software?.pipelines).toEqual(['bug', 'example', 'feature'])
    expect(software?.routers).toContain('classifier')
  })

  it('compiles the package entry router and a named pipeline', () => {
    const catalog = loadCatalog(config)
    const entry = compileRun(catalog, 'std:software')
    expect(entry.root.kind).toBe('router')
    expect(entry.root.routes?.map((route) => route.when)).toEqual(['feature', 'bug', 'example'])

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

  it('injects route criteria into router prompts', () => {
    const catalog = loadCatalog(config)
    const primary = compileRun(catalog)
    expect(primary.root.prompt).toContain(
      '- `software-development` — a normal software feature, bug, or example request.'
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
    const catalog = loadCatalog(config)
    const example = compileRun(catalog, 'std:software/example')
    const group = example.root.children?.find((step) => step.name === 'task_group')
    expect(group?.kind).toBe('group')
    expect(group?.children?.length).toBe(2)
    const router = example.root.children?.find((step) => step.name === 'task_router')
    expect(router?.kind).toBe('router')
    expect(router?.routes?.every((route) => route.target)).toBe(true)
    expect(router?.prompt).toContain('- `feature` — new work.')
    expect(router?.prompt).not.toContain('[ROUTES]')
    expect(example.snapshot).toContain('background_task')
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
})
