import type { CompiledNode } from '@clara/orchestration/types'
import type { CompiledDiff, FieldChange, NodeChange, RouteDescriptor } from './types.ts'
import { COMPARED_FIELDS } from './preview.ts'

export function flattenCompiled(root: CompiledNode): Map<string, CompiledNode> {
  const nodes = new Map<string, CompiledNode>()
  const walk = (node: CompiledNode): void => {
    if (!nodes.has(node.path)) nodes.set(node.path, node)
    for (const child of node.children ?? []) walk(child)
    for (const route of node.routes ?? []) {
      if (route.target) walk(route.target)
    }
  }
  walk(root)
  return nodes
}

export function routeDescriptors(node: CompiledNode): RouteDescriptor[] {
  return (node.routes ?? []).map((route) => ({
    when: route.when,
    run: route.run,
    ...(route.criteria ? { criteria: route.criteria } : {}),
    ...(route.description ? { description: route.description } : {}),
    ...(route.target ? { target: route.target.path } : {}),
  }))
}

function comparable(node: CompiledNode, field: string): unknown {
  if (field === 'routes') {
    return routeDescriptors(node).map((route) => {
      const { target: _target, ...rest } = route
      return rest
    })
  }
  if (field === 'children') {
    return (node.children ?? []).map((child) => child.path)
  }
  return (node as unknown as Record<string, unknown>)[field]
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function diffNode(current: CompiledNode, pinned: CompiledNode): FieldChange[] {
  const fields = [...COMPARED_FIELDS, 'routes', 'children']
  const changes: FieldChange[] = []
  for (const field of fields) {
    const before = comparable(pinned, field)
    const after = comparable(current, field)
    if (!same(before, after)) {
      changes.push({
        field,
        before: before ?? null,
        after: after ?? null,
      })
    }
  }
  return changes
}

export function diffCompiled(current: CompiledNode, pinned: CompiledNode): CompiledDiff {
  const left = flattenCompiled(pinned)
  const right = flattenCompiled(current)
  const changes: NodeChange[] = []
  let unchanged = 0

  for (const [path, node] of right) {
    const previous = left.get(path)
    if (!previous) {
      changes.push({ path, kind: 'added', fields: [] })
      continue
    }
    const fields = diffNode(node, previous)
    if (fields.length) {
      changes.push({ path, kind: 'changed', fields })
    } else {
      unchanged++
    }
  }

  for (const path of left.keys()) {
    if (!right.has(path)) changes.push({ path, kind: 'removed', fields: [] })
  }

  changes.sort((a, b) => a.path.localeCompare(b.path))
  return {
    changes,
    summary: {
      added: changes.filter((change) => change.kind === 'added').length,
      removed: changes.filter((change) => change.kind === 'removed').length,
      changed: changes.filter((change) => change.kind === 'changed').length,
      unchanged,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Accept either a compile snapshot (`{ root, sources, packages }`) or the root
 * node snapshot the service stores on a run.
 */
export function inspectSnapshot(input: string | unknown): CompiledNode {
  const parsed = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (isRecord(parsed) && isRecord(parsed.root)) {
    return parsed.root as unknown as CompiledNode
  }
  if (isRecord(parsed) && typeof parsed.path === 'string' && typeof parsed.kind === 'string') {
    return parsed as unknown as CompiledNode
  }
  throw new Error('The snapshot does not contain a compiled step tree.')
}
