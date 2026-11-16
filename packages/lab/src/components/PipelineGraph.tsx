import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Boxes,
  CircleDashed,
  Layers,
  Maximize2,
  RotateCcw,
  SquareTerminal,
  Waypoints,
  Workflow,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { cn } from '@clara/ui/lib/utils'
import {
  buildReviewLayout,
  type NodeModelInfo,
  type ReviewEdge,
  type ReviewNode,
  type ReviewNodeKind,
} from '../lib/graph'
import type { CompiledNode, PackageEntryInfo } from '../types'

const KIND_STYLE: Record<
  ReviewNodeKind,
  { icon: typeof Bot; label: string; accent: string; border: string; glow: string }
> = {
  pipeline: {
    icon: Workflow,
    label: 'Pipeline',
    accent: 'text-violet-500 dark:text-violet-400',
    border: 'border-violet-500/45 bg-violet-500/[0.06]',
    glow: 'shadow-violet-500/20',
  },
  wrapper: {
    icon: Wrench,
    label: 'Wrapper',
    accent: 'text-amber-500 dark:text-amber-400',
    border: 'border-amber-500/45 bg-amber-500/[0.06]',
    glow: 'shadow-amber-500/20',
  },
  group: {
    icon: Boxes,
    label: 'Group',
    accent: 'text-sky-500 dark:text-sky-400',
    border: 'border-sky-500/45 bg-sky-500/[0.06]',
    glow: 'shadow-sky-500/20',
  },
  router: {
    icon: Waypoints,
    label: 'Router',
    accent: 'text-orange-500 dark:text-orange-400',
    border: 'border-orange-500/45 bg-orange-500/[0.06]',
    glow: 'shadow-orange-500/20',
  },
  agent: {
    icon: Bot,
    label: 'Agent',
    accent: 'text-emerald-500 dark:text-emerald-400',
    border: 'border-emerald-500/45 bg-emerald-500/[0.06]',
    glow: 'shadow-emerald-500/20',
  },
  script: {
    icon: SquareTerminal,
    label: 'Script',
    accent: 'text-cyan-500 dark:text-cyan-400',
    border: 'border-cyan-500/45 bg-cyan-500/[0.06]',
    glow: 'shadow-cyan-500/20',
  },
  recovery: {
    icon: RotateCcw,
    label: 'Recovery',
    accent: 'text-rose-500 dark:text-rose-400',
    border: 'border-rose-500/45 bg-rose-500/[0.06]',
    glow: 'shadow-rose-500/20',
  },
  slot: {
    icon: CircleDashed,
    label: 'Slot',
    accent: 'text-indigo-500 dark:text-indigo-400',
    border: 'border-dashed border-indigo-500/60 bg-indigo-500/[0.04]',
    glow: 'shadow-indigo-500/20',
  },
}

interface HoveredInput {
  from: string
  to: string
  label: string
}

export function PipelineGraph({
  root,
  packages,
  selected,
  onSelect,
  rootBadge = 'Entry',
}: {
  root: CompiledNode
  packages: PackageEntryInfo[]
  selected?: CompiledNode
  onSelect: (node: CompiledNode) => void
  rootBadge?: string
}) {
  const layout = useMemo(() => buildReviewLayout(root, packages), [root, packages])
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [fitMode, setFitMode] = useState<'width' | 'all' | 'custom'>('custom')
  const [customZoom, setCustomZoom] = useState(1)
  const [hovered, setHovered] = useState<HoveredInput | null>(null)
  const centeredRoot = useRef<string | undefined>(undefined)
  const selectedPath = selected?.path

  useEffect(() => {
    setHovered(null)
  }, [layout.root])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const rootNode = layout.nodeByPath.get(layout.root)
    if (!container || !rootNode || !viewport.width || centeredRoot.current === layout.root) {
      return
    }
    centeredRoot.current = layout.root
    setFitMode('custom')
    setCustomZoom(1)
    const left = rootNode.x + rootNode.width / 2 - container.clientWidth / 2
    requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, left)
      container.scrollTop = 0
    })
  }, [layout, viewport.width])

  const widthFit = viewport.width
    ? Math.min(1, Math.max(0.25, (viewport.width - 28) / layout.width))
    : 1
  const allFit = viewport.width
    ? Math.min(
        1,
        Math.max(
          0.2,
          Math.min((viewport.width - 28) / layout.width, (viewport.height - 28) / layout.height)
        )
      )
    : 1
  const zoom = fitMode === 'width' ? widthFit : fitMode === 'all' ? allFit : customZoom

  const setZoom = (value: number): void => {
    setFitMode('custom')
    setCustomZoom(Math.min(1.6, Math.max(0.2, value)))
  }

  useEffect(() => {
    if (!selectedPath) return
    const node = layout.nodeByPath.get(selectedPath)
    const container = containerRef.current
    if (!node || !container) return
    const top = node.y * zoom
    const bottom = (node.y + node.height) * zoom
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    if (top < viewTop + 24 || bottom > viewBottom - 24) {
      container.scrollTo({
        top: Math.max(0, top - 48),
        behavior: 'smooth',
      })
    }
  }, [selectedPath, zoom, layout])

  const sourceHighlight = hovered?.from
  const inputEdges = layout.edges.filter((edge) => {
    if (edge.kind !== 'input') return false
    if (hovered && edge.from === hovered.from && edge.to === hovered.to) return true
    return selectedPath ? edge.to === selectedPath : false
  })
  const visibleEdges = [...layout.edges.filter((edge) => edge.kind !== 'input'), ...inputEdges]

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pointer-events-auto absolute top-2 right-2 z-20 flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setZoom(zoom - 0.1)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut />
        </Button>
        <span className="min-w-10 text-center font-mono text-[10px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setZoom(zoom + 0.1)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setFitMode('all')}
          aria-label="Fit graph"
          title="Fit graph"
        >
          <Maximize2 />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setFitMode('width')}
          aria-label="Fit graph width"
          title="Fit graph width"
        >
          <Layers />
        </Button>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto"
          style={{ width: layout.width * zoom, height: layout.height * zoom }}
        >
          <div
            className="relative origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="review-arrow-flow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
                </marker>
                <marker
                  id="review-arrow-route"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-orange-500/70" />
                </marker>
                <marker
                  id="review-arrow-failure"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-rose-500/70" />
                </marker>
                <marker
                  id="review-arrow-input"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-status-info" />
                </marker>
              </defs>
              {visibleEdges.map((edge) => {
                const geometry = edgeGeometry(edge, layout.nodeByPath)
                if (!geometry) return null
                const highlighted =
                  (hovered &&
                    edge.kind === 'input' &&
                    edge.from === hovered.from &&
                    edge.to === hovered.to) ||
                  (selectedPath && edge.kind === 'input' && edge.to === selectedPath)
                return (
                  <path
                    key={edge.id}
                    d={geometry.path}
                    fill="none"
                    className={cn(
                      edge.kind === 'flow' && 'stroke-border',
                      edge.kind === 'route' && 'stroke-orange-500/60',
                      edge.kind === 'failure' && 'stroke-rose-500/60',
                      edge.kind === 'input' && 'stroke-status-info/60',
                      highlighted && edge.kind === 'input' && 'stroke-status-info'
                    )}
                    strokeWidth={highlighted ? 2.4 : 1.4}
                    strokeDasharray={
                      edge.kind === 'input' || edge.kind === 'failure' ? '5 4' : undefined
                    }
                    markerEnd={`url(#review-arrow-${edge.kind})`}
                  />
                )
              })}
            </svg>

            {layout.edges
              .filter((edge) => edge.kind === 'route' || edge.kind === 'failure')
              .map((edge) => {
                const geometry = edgeGeometry(edge, layout.nodeByPath)
                if (!geometry || !edge.label) return null
                return (
                  <span
                    key={`label:${edge.id}`}
                    className={cn(
                      'absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-1.5 py-0.5 font-mono text-[9px] whitespace-nowrap',
                      edge.kind === 'route'
                        ? 'border-orange-500/35 text-orange-600 dark:text-orange-300'
                        : 'border-rose-500/35 text-rose-600 dark:text-rose-300'
                    )}
                    style={{ left: geometry.labelX, top: geometry.labelY }}
                  >
                    {edge.label}
                  </span>
                )
              })}

            {layout.nodes.map((node) => (
              <GraphNodeCard
                key={node.path}
                layoutNode={node}
                nodeByPath={layout.nodeByPath}
                rootPath={layout.root}
                rootBadge={rootBadge}
                selected={selectedPath === node.path}
                highlighted={sourceHighlight === node.path}
                onSelect={onSelect}
                onHoverInput={setHovered}
                hovered={hovered}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function GraphNodeCard({
  layoutNode,
  nodeByPath,
  rootPath,
  rootBadge,
  selected,
  highlighted,
  onSelect,
  onHoverInput,
  hovered,
}: {
  layoutNode: ReviewNode
  nodeByPath: Map<string, ReviewNode>
  rootPath: string
  rootBadge?: string
  selected: boolean
  highlighted: boolean
  onSelect: (node: CompiledNode) => void
  onHoverInput: (value: HoveredInput | null) => void
  hovered: HoveredInput | null
}) {
  const node = layoutNode.node
  const style = KIND_STYLE[layoutNode.kind]
  const Icon = style.icon
  const inputs = Object.entries(node.inputs ?? {})
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(node)
        }
      }}
      className={cn(
        'group/node absolute flex cursor-pointer flex-col overflow-hidden rounded-xl border p-3 text-left shadow-sm transition-shadow outline-none',
        style.border,
        style.glow,
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        highlighted && !selected && 'ring-2 ring-status-info ring-offset-2 ring-offset-background'
      )}
      style={{
        left: layoutNode.x,
        top: layoutNode.y,
        width: layoutNode.width,
        height: layoutNode.height,
      }}
      aria-label={`${style.label} ${node.name}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-4 shrink-0', style.accent)} aria-hidden="true" />
        <span className={cn('text-[10px] font-semibold tracking-[0.11em] uppercase', style.accent)}>
          {style.label}
        </span>
        {layoutNode.path === rootPath && rootBadge ? (
          <span className="rounded-full border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-primary uppercase">
            {rootBadge}
          </span>
        ) : null}
        {node.enforcement ? (
          <span className="ml-auto rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {node.enforcement}
          </span>
        ) : null}
      </div>

      <div className="mt-1 min-w-0">
        <div className="truncate text-[13px] leading-tight font-semibold">{node.title}</div>
        <div className="truncate font-mono text-[9px] text-muted-foreground">{node.name}</div>
      </div>

      {node.slot ? (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-indigo-500/40 bg-indigo-500/5 px-2 py-1 text-[10px] text-indigo-600 dark:text-indigo-300">
          <CircleDashed className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Runtime pipeline runs here</span>
        </div>
      ) : (
        <ModelLine model={layoutNode.model} script={layoutNode.kind === 'script'} />
      )}

      <div className="mt-1.5 min-h-0 border-t pt-1">
        {node.slot ? (
          <div className="px-1 text-[10px] text-muted-foreground">
            The routed pipeline replaces this slot.
          </div>
        ) : inputs.length ? (
          <div className="space-y-0.5">
            {inputs.map(([label, path]) => {
              const active =
                hovered?.from === path && hovered.to === node.path && hovered.label === label
              return (
                <div
                  key={`${label}:${path}`}
                  className={cn(
                    'flex items-center gap-1 rounded px-1 py-0.5 text-[10px]',
                    active ? 'bg-status-info/15 text-status-info' : 'text-muted-foreground'
                  )}
                  onMouseEnter={() => onHoverInput({ from: path, to: node.path, label })}
                  onMouseLeave={() => onHoverInput(null)}
                  onFocus={() => onHoverInput({ from: path, to: node.path, label })}
                  onBlur={() => onHoverInput(null)}
                  tabIndex={0}
                  title={`Input ${label} ← ${path}`}
                >
                  <span className="shrink-0 font-medium text-foreground/80">{label}</span>
                  <span className="shrink-0">←</span>
                  <span className="truncate">{inputLabel(path, nodeByPath, rootPath)}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-1 text-[10px] text-muted-foreground/70">no inputs</div>
        )}
      </div>
    </div>
  )
}

function inputLabel(path: string, nodes: Map<string, ReviewNode>, rootPath: string): string {
  if (path === rootPath) return 'entry'
  const node = nodes.get(path)
  if (node) return node.node.title
  const segments = path.split('/')
  const last = segments[segments.length - 1] ?? path
  return last.replace(/^\d+-/, '')
}

function ModelLine({ model, script }: { model: NodeModelInfo; script: boolean }) {
  if (script) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <span className="rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">
          no model
        </span>
        {model.inherited && model.origin ? (
          <span className="truncate text-[9px] text-muted-foreground">{model.origin}</span>
        ) : null}
      </div>
    )
  }

  if (!model.required && model.missing === 'both') {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <span className="rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">
          no model
        </span>
      </div>
    )
  }

  if (model.missing !== 'none') {
    return (
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
            model.missing === 'provider'
              ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
              : 'border-status-danger/40 bg-status-danger/10 text-status-danger'
          )}
          title={missingHint(model)}
        >
          {model.missing === 'provider'
            ? 'no provider'
            : model.missing === 'model'
              ? 'no model'
              : 'model unresolved'}
        </span>
        {model.label !== 'model unresolved' ? (
          <span className="truncate font-mono text-[10px] text-foreground/80">{model.label}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-[10px] text-foreground/80">{model.label}</span>
      {model.inherited ? (
        <span
          className="shrink-0 rounded-full border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground"
          title={model.origin}
        >
          inherited
        </span>
      ) : null}
      {model.inherited && model.origin ? (
        <span className="truncate text-[9px] text-muted-foreground">{model.origin}</span>
      ) : null}
    </div>
  )
}

function missingHint(model: NodeModelInfo): string {
  if (model.missing === 'provider') return `Model ${model.model} has no provider.`
  if (model.missing === 'model') return `Provider ${model.provider} has no model.`
  return model.required
    ? 'No model or provider resolved; the harness default will be used.'
    : 'No model or provider applies to this node.'
}

function edgeGeometry(
  edge: ReviewEdge,
  nodes: Map<string, ReviewNode>
): { path: string; labelX: number; labelY: number } | undefined {
  const from = nodes.get(edge.from)
  const to = nodes.get(edge.to)
  if (!from || !to) return undefined
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const mid = (y1 + y2) / 2
  return {
    path: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
    labelX: x2,
    labelY: y2 - 10,
  }
}
