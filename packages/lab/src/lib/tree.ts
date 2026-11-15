import type { CompiledNode } from '../types'

export function findCompiledNode(root: CompiledNode, path: string): CompiledNode | undefined {
  if (root.path === path) return root
  for (const child of root.children ?? []) {
    const found = findCompiledNode(child, path)
    if (found) return found
  }
  for (const route of root.routes ?? []) {
    if (!route.target) continue
    const found = findCompiledNode(route.target, path)
    if (found) return found
  }
  return undefined
}
