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
      'write_tests',
      'build_feature',
      'code_review',
      'update_docs',
    ])
    expect(feature.root.children?.[0].policy?.rules?.[0].effect).toBe('deny')
    expect(feature.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
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
