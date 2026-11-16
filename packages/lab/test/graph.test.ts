import { describe, expect, it } from 'vitest'
import { buildReviewLayout, classifyNode } from '../src/lib/graph'
import { buildPipelineTree } from '../src/lib/pipelines'
import type { CompiledNode, PackageEntryInfo, TargetInfo } from '../src/types'

function compiled(
  partial: Partial<CompiledNode> & Pick<CompiledNode, 'path' | 'kind' | 'name'>
): CompiledNode {
  return {
    title: partial.name,
    packageId: 'pkg',
    ...partial,
  }
}

const packages: PackageEntryInfo[] = [
  {
    id: 'pkg',
    name: 'Package',
    version: 1,
    dir: '/pkg',
    entry: { pipeline: 'feature' },
    defaults: { model: 'deepseek', provider: 'opencode' },
    pipelines: [
      { id: 'feature', name: 'Feature development' },
      { id: 'bug', name: 'Bug fix' },
    ],
    routers: [{ id: 'classifier' }],
    agents: [],
    scripts: [],
    wrappers: [],
  },
]

describe('review graph layout', () => {
  it('lays out a pipeline top-down with sequence, route, and input edges', () => {
    const first = compiled({
      path: 'feature/1-brief',
      kind: 'agent',
      name: 'brief',
      title: 'Brief',
      model: 'deepseek',
      provider: 'opencode',
      declared: ['model', 'provider'],
    })
    const second = compiled({
      path: 'feature/2-implement',
      kind: 'agent',
      name: 'implement',
      title: 'Implement',
      model: 'deepseek',
      provider: 'opencode',
      inputs: { brief: first.path },
      declared: ['model', 'provider'],
    })
    const target = compiled({
      path: 'feature/route-bug/1-bug',
      kind: 'pipeline',
      name: 'bug',
      title: 'Bug fix',
    })
    const router = compiled({
      path: 'feature/3-route',
      kind: 'router',
      name: 'route',
      title: 'Route',
      model: 'deepseek',
      provider: 'opencode',
      declared: ['model', 'provider'],
      routes: [{ when: 'bug', run: 'bug', target }],
    })
    const root = compiled({
      path: 'feature',
      kind: 'pipeline',
      name: 'feature',
      title: 'Feature development',
      model: 'deepseek',
      provider: 'opencode',
      declared: ['default_model', 'default_provider'],
      children: [first, second, router],
    })

    const layout = buildReviewLayout(root, packages)
    expect(layout.nodes).toHaveLength(5)
    expect(layout.nodeByPath.get(first.path)?.layer).toBe(1)
    expect(layout.nodeByPath.get(second.path)?.layer).toBe(2)
    expect(layout.nodeByPath.get(router.path)?.layer).toBe(3)
    expect(layout.nodeByPath.get(target.path)?.layer).toBe(4)

    const input = layout.edges.find((edge) => edge.kind === 'input')
    expect(input).toMatchObject({ from: first.path, to: second.path, label: 'brief' })
    expect(layout.edges.some((edge) => edge.kind === 'route' && edge.label === 'bug')).toBe(true)
    expect(layout.height).toBeGreaterThan(layout.width)
  })

  it('classifies wrappers and recovers model origins', () => {
    const wrapper = compiled({
      path: 'wrapper',
      kind: 'group',
      name: 'wrapper:worktree',
      title: 'Worktree',
    })
    expect(classifyNode(wrapper)).toBe('wrapper')

    const child = compiled({
      path: 'feature/1-brief',
      kind: 'agent',
      name: 'brief',
      title: 'Brief',
      model: 'deepseek',
      provider: 'opencode',
      declared: [],
    })
    const root = compiled({
      path: 'feature',
      kind: 'pipeline',
      name: 'feature',
      title: 'Feature development',
      model: 'deepseek',
      provider: 'opencode',
      declared: ['default_model', 'default_provider'],
      children: [child],
    })
    const layout = buildReviewLayout(root, packages)
    expect(layout.nodeByPath.get(child.path)?.model.inherited).toBe(true)
    expect(layout.nodeByPath.get(child.path)?.model.origin).toBe('from Feature development')

    const missing = compiled({
      path: 'feature/2-implement',
      kind: 'agent',
      name: 'implement',
      title: 'Implement',
      declared: [],
    })
    const missingRoot = compiled({
      path: 'feature',
      kind: 'pipeline',
      name: 'feature',
      title: 'Feature development',
      children: [missing],
    })
    const missingLayout = buildReviewLayout(missingRoot, [])
    expect(missingLayout.nodeByPath.get(missing.path)?.model.missing).toBe('both')
    expect(missingLayout.nodeByPath.get(missing.path)?.model.required).toBe(true)
  })
})

describe('pipeline tree', () => {
  it('groups namespaces, packages, entries, and pipelines', () => {
    const targets: TargetInfo[] = [
      {
        ref: '',
        label: 'Workspace entry',
        packageId: 'pkg',
        packageName: 'Package',
        kind: 'entry',
        entryKind: 'pipeline',
      },
      {
        ref: 'std:software',
        label: 'std:software entry',
        packageId: 'software',
        packageName: 'Software',
        kind: 'entry',
        namespace: 'std',
        alias: 'software',
        entryKind: 'router',
      },
      {
        ref: 'std:software/feature',
        label: 'Feature',
        packageId: 'software',
        packageName: 'Software',
        kind: 'pipeline',
        namespace: 'std',
        alias: 'software',
      },
    ]
    const tree = buildPipelineTree(
      [
        {
          id: 'pkg',
          name: 'Package',
          version: 1,
          dir: '/pkg',
          entry: { router: 'classifier' },
          pipelines: [],
          routers: [],
          agents: [],
          scripts: [],
          wrappers: [],
        },
        {
          id: 'software',
          name: 'Software',
          version: 1,
          dir: '/software',
          namespace: 'std',
          alias: 'software',
          entry: { router: 'classifier' },
          pipelines: [{ id: 'feature', name: 'Feature development' }],
          routers: [],
          agents: [],
          scripts: [],
          wrappers: [],
        },
      ],
      targets
    )
    expect(tree.map((item) => item.id)).toEqual(['root', 'std'])
    expect(tree[0]?.packages[0]?.entry?.ref).toBe('')
    expect(tree[1]?.packages[0]?.entry?.ref).toBe('std:software')
    expect(tree[1]?.packages[0]?.pipelines[0]?.ref).toBe('std:software/feature')
  })
})
