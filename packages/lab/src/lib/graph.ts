import type { CompiledNode, PackageEntryInfo } from '../types'

export type ReviewNodeKind =
  'pipeline' | 'wrapper' | 'group' | 'router' | 'agent' | 'script' | 'recovery'

export interface ReviewNode {
  node: CompiledNode
  path: string
  kind: ReviewNodeKind
  layer: number
  x: number
  y: number
  width: number
  height: number
  order: number
  model: NodeModelInfo
}

export type ReviewEdgeKind = 'flow' | 'route' | 'failure' | 'input'

export interface ReviewEdge {
  id: string
  from: string
  to: string
  kind: ReviewEdgeKind
  label?: string
}

export interface ReviewLayout {
  root: string
  nodes: ReviewNode[]
  edges: ReviewEdge[]
  width: number
  height: number
  nodeByPath: Map<string, ReviewNode>
  parentByPath: Map<string, string>
}

export type ModelMissing = 'none' | 'both' | 'model' | 'provider'

export interface NodeModelInfo {
  model?: string
  provider?: string
  label: string
  missing: ModelMissing
  inherited: boolean
  origin?: string
  required: boolean
}

const NODE_WIDTH = 274
const NODE_BASE_HEIGHT = 110
const NODE_INPUT_HEIGHT = 20
const NODE_GAP_X = 24
const LAYER_GAP_Y = 54
const PADDING = 40

export function classifyNode(node: CompiledNode): ReviewNodeKind {
  if (node.recoveryFor) return 'recovery'
  if (node.kind === 'group') {
    return node.name.startsWith('wrapper:') ? 'wrapper' : 'group'
  }
  return node.kind
}

export function buildReviewLayout(
  root: CompiledNode,
  packages: PackageEntryInfo[] = []
): ReviewLayout {
  const nodes: Array<Omit<ReviewNode, 'layer' | 'x' | 'y'>> = []
  const edges: ReviewEdge[] = []
  const parentByPath = new Map<string, string>()
  const byPath = new Map<string, CompiledNode>()
  let order = 0

  const addNode = (node: CompiledNode, parent?: string): void => {
    if (byPath.has(node.path)) return
    if (parent) parentByPath.set(node.path, parent)
    byPath.set(node.path, node)
    const kind = classifyNode(node)
    const height = NODE_BASE_HEIGHT + Object.keys(node.inputs ?? {}).length * NODE_INPUT_HEIGHT
    nodes.push({
      node,
      path: node.path,
      kind,
      width: NODE_WIDTH,
      height,
      order: order++,
      model: describeNodeModel(node, byPath, parentByPath, packages),
    })
  }

  const addEdge = (from: string, to: string, kind: ReviewEdgeKind, label?: string): void => {
    if (from === to) return
    edges.push({
      id: `${kind}:${from}->${to}:${label ?? ''}`,
      from,
      to,
      kind,
      ...(label ? { label } : {}),
    })
  }

  const walk = (node: CompiledNode, parent?: string): void => {
    addNode(node, parent)
    const children = node.children ?? []
    if (children.length) {
      addEdge(node.path, children[0].path, 'flow')
      for (let index = 1; index < children.length; index++) {
        addEdge(children[index - 1].path, children[index].path, 'flow')
      }
    }
    for (const child of children) walk(child, node.path)
    for (const route of node.routes ?? []) {
      if (!route.target) continue
      addEdge(node.path, route.target.path, 'route', route.when)
      walk(route.target, node.path)
    }
    if (node.onFailure) {
      const recovery = node.onFailure.children
      if (recovery.length) {
        addEdge(node.path, recovery[0].path, 'failure', 'on failure')
        for (let index = 1; index < recovery.length; index++) {
          addEdge(recovery[index - 1].path, recovery[index].path, 'failure')
        }
      }
      for (const child of recovery) walk(child, node.path)
    }
  }

  walk(root)

  for (const node of nodes) {
    for (const [label, path] of Object.entries(node.node.inputs ?? {})) {
      if (byPath.has(path)) addEdge(path, node.path, 'input', label)
    }
  }

  const layers = assignLayers(nodes, edges)
  orderLayers(layers, nodes, edges)
  const positioned = placeNodes(layers, nodes)
  const nodeByPath = new Map(positioned.map((node) => [node.path, node]))
  const width =
    Math.max(...positioned.map((node) => node.x + node.width), NODE_WIDTH + PADDING * 2) + PADDING
  const height =
    Math.max(...positioned.map((node) => node.y + node.height), NODE_BASE_HEIGHT) + PADDING

  return {
    root: root.path,
    nodes: positioned,
    edges,
    width,
    height,
    nodeByPath,
    parentByPath,
  }
}

function assignLayers(
  nodes: Array<Omit<ReviewNode, 'layer' | 'x' | 'y'>>,
  edges: ReviewEdge[]
): Map<number, string[]> {
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, ReviewEdge[]>()
  for (const node of nodes) {
    indegree.set(node.path, 0)
    outgoing.set(node.path, [])
  }
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge)
  }

  const layerOf = new Map<string, number>()
  const queue = nodes.filter((node) => indegree.get(node.path) === 0).map((node) => node.path)
  for (const path of queue) layerOf.set(path, 0)
  let cursor = 0
  while (cursor < queue.length) {
    const path = queue[cursor++]
    const layer = layerOf.get(path) ?? 0
    for (const edge of outgoing.get(path) ?? []) {
      layerOf.set(edge.to, Math.max(layerOf.get(edge.to) ?? 0, layer + 1))
      const next = (indegree.get(edge.to) ?? 0) - 1
      indegree.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }

  for (const node of nodes) {
    if (!layerOf.has(node.path)) layerOf.set(node.path, 0)
  }

  const layers = new Map<number, string[]>()
  for (const node of nodes) {
    const layer = layerOf.get(node.path) ?? 0
    const list = layers.get(layer) ?? []
    list.push(node.path)
    layers.set(layer, list)
  }
  return layers
}

function orderLayers(
  layers: Map<number, string[]>,
  nodes: Array<Omit<ReviewNode, 'layer' | 'x' | 'y'>>,
  edges: ReviewEdge[]
): void {
  const baseOrder = new Map(nodes.map((node) => [node.path, node.order]))
  const predecessors = new Map<string, string[]>()
  const successors = new Map<string, string[]>()
  for (const node of nodes) {
    predecessors.set(node.path, [])
    successors.set(node.path, [])
  }
  for (const edge of edges) {
    predecessors.get(edge.to)?.push(edge.from)
    successors.get(edge.from)?.push(edge.to)
  }

  const position = new Map<string, number>()
  const maxLayer = Math.max(...layers.keys(), 0)
  for (const [layer, list] of layers) {
    list.sort((left, right) => (baseOrder.get(left) ?? 0) - (baseOrder.get(right) ?? 0))
    list.forEach((path, index) => position.set(path, index))
    layers.set(layer, list)
  }

  const reorder = (layer: number, neighbours: Map<string, string[]>): void => {
    const list = layers.get(layer)
    if (!list) return
    const scored = list.map((path) => {
      const values = (neighbours.get(path) ?? [])
        .map((neighbour) => position.get(neighbour))
        .filter((value): value is number => value !== undefined)
      const score = values.length
        ? values.reduce((total, value) => total + value, 0) / values.length
        : (baseOrder.get(path) ?? 0)
      return { path, score, tie: baseOrder.get(path) ?? 0 }
    })
    scored.sort((left, right) => left.score - right.score || left.tie - right.tie)
    scored.forEach((item, index) => position.set(item.path, index))
    layers.set(
      layer,
      scored.map((item) => item.path)
    )
  }

  for (let pass = 0; pass < 3; pass++) {
    for (let layer = 1; layer <= maxLayer; layer++) reorder(layer, predecessors)
    for (let layer = maxLayer - 1; layer >= 0; layer--) reorder(layer, successors)
  }
}

function placeNodes(
  layers: Map<number, string[]>,
  nodes: Array<Omit<ReviewNode, 'layer' | 'x' | 'y'>>
): ReviewNode[] {
  const byPath = new Map(nodes.map((node) => [node.path, node]))
  const ordered = [...layers.entries()].sort(([left], [right]) => left - right)
  const maxLayerWidth = Math.max(
    NODE_WIDTH,
    ...ordered.map(([, list]) => list.length * NODE_WIDTH + (list.length - 1) * NODE_GAP_X)
  )
  const placed: ReviewNode[] = []
  let y = PADDING
  for (const [layer, list] of ordered) {
    const layerNodes = list
      .map((path) => byPath.get(path))
      .filter((node): node is Omit<ReviewNode, 'layer' | 'x' | 'y'> => Boolean(node))
    const layerWidth = layerNodes.length * NODE_WIDTH + (layerNodes.length - 1) * NODE_GAP_X
    const layerHeight = Math.max(NODE_BASE_HEIGHT, ...layerNodes.map((node) => node.height))
    let x = (maxLayerWidth - layerWidth) / 2 + PADDING
    for (const node of layerNodes) {
      placed.push({ ...node, layer, x, y })
      x += NODE_WIDTH + NODE_GAP_X
    }
    y += layerHeight + LAYER_GAP_Y
  }
  return placed
}

function describeNodeModel(
  node: CompiledNode,
  byPath: Map<string, CompiledNode>,
  parentByPath: Map<string, string>,
  packages: PackageEntryInfo[]
): NodeModelInfo {
  const kind = classifyNode(node)
  const required = kind === 'agent' || kind === 'router'
  const declared = new Set(node.declared ?? [])
  const modelDeclared =
    node.kind === 'pipeline' ? declared.has('default_model') : declared.has('model')
  const providerDeclared =
    node.kind === 'pipeline' ? declared.has('default_provider') : declared.has('provider')
  const missing: ModelMissing =
    node.model && node.provider
      ? 'none'
      : !node.model && !node.provider
        ? 'both'
        : node.model
          ? 'provider'
          : 'model'
  const inherited =
    missing !== 'both' &&
    (!modelDeclared || !providerDeclared) &&
    (Boolean(node.model) || Boolean(node.provider))
  const modelValue = node.model?.trim()
  const providerValue = node.provider?.trim()
  const modelOrigin =
    modelValue && !modelDeclared
      ? fieldOrigin('model', node, modelValue, byPath, parentByPath, packages)
      : undefined
  const providerOrigin =
    providerValue && !providerDeclared
      ? fieldOrigin('provider', node, providerValue, byPath, parentByPath, packages)
      : undefined
  const origin =
    modelOrigin && providerOrigin && modelOrigin !== providerOrigin
      ? `${modelOrigin} · ${providerOrigin}`
      : (modelOrigin ?? providerOrigin)

  return {
    ...(modelValue ? { model: modelValue } : {}),
    ...(providerValue ? { provider: providerValue } : {}),
    label:
      modelValue && providerValue
        ? `${providerValue}/${modelValue}`
        : (modelValue ?? providerValue ?? (kind === 'script' ? 'no model' : 'model unresolved')),
    missing,
    inherited,
    ...(origin ? { origin } : {}),
    required,
  }
}

function fieldOrigin(
  field: 'model' | 'provider',
  node: CompiledNode,
  value: string,
  byPath: Map<string, CompiledNode>,
  parentByPath: Map<string, string>,
  packages: PackageEntryInfo[]
): string {
  const key = field === 'model' ? 'model' : 'provider'
  const pipelineKey = field === 'model' ? 'default_model' : 'default_provider'
  let current = parentByPath.get(node.path)
  while (current) {
    const ancestor = byPath.get(current)
    if (ancestor) {
      const declared = new Set(ancestor.declared ?? [])
      const owns =
        ancestor[key] === value &&
        (ancestor.kind === 'pipeline' ? declared.has(pipelineKey) : declared.has(key))
      if (owns) return `from ${ancestor.title}`
    }
    current = parentByPath.get(current)
  }

  const pkg = packages.find((entry) => entry.id === node.packageId)
  const defaults = pkg?.defaults ?? {}
  if (defaults[key] === value) return `from ${pkg?.id ?? 'package'} defaults`
  if (field === 'model' && node.agent) return `from agent ${node.agent}`
  return 'inherited'
}
