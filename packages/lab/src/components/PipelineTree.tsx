import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  FolderTree,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Workflow,
  Wrench,
} from 'lucide-react'
import { ScrollArea } from '@clara/ui/components/scroll-area'
import { cn } from '@clara/ui/lib/utils'
import { buildPipelineTree, type PipelineLeaf } from '../lib/pipelines'
import type { PackageEntryInfo, TargetInfo } from '../types'

export function PipelineTree({
  packages,
  targets,
  selected,
  onSelect,
  collapsed,
  onToggle,
}: {
  packages: PackageEntryInfo[]
  targets: TargetInfo[]
  selected: string
  onSelect: (ref: string) => void
  collapsed: boolean
  onToggle: () => void
}) {
  const tree = useMemo(() => buildPipelineTree(packages, targets), [packages, targets])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['ns:root', 'ns:std']))

  useEffect(() => {
    const keys = new Set<string>()
    for (const namespace of tree) {
      for (const pkg of namespace.packages) {
        if (
          pkg.entry?.ref === selected ||
          pkg.pipelines.some((leaf) => leaf.ref === selected) ||
          pkg.wrappers.some((leaf) => leaf.ref === selected)
        ) {
          keys.add(`ns:${namespace.id}`)
          keys.add(`pkg:${namespace.id}:${pkg.id}`)
        }
      }
    }
    if (!keys.size) return
    setExpanded((current) => {
      const next = new Set(current)
      let changed = false
      for (const key of keys) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [selected, tree])

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col border-r bg-card transition-[width] duration-150',
        collapsed ? 'w-11' : 'w-64'
      )}
      aria-label="Pipelines"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand pipeline tree' : 'Collapse pipeline tree'}
          title={collapsed ? 'Expand pipelines' : 'Collapse pipelines'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Pipelines
            </div>
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex flex-1 items-start justify-center pt-3">
          <FolderTree className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-2">
            {tree.map((namespace) => {
              const namespaceKey = `ns:${namespace.id}`
              const namespaceOpen = expanded.has(namespaceKey)
              return (
                <div key={namespace.id}>
                  <TreeRow
                    depth={0}
                    open={namespaceOpen}
                    icon={<FolderTree className="size-3.5" />}
                    label={namespace.label}
                    onClick={() => toggle(namespaceKey)}
                  />
                  {namespaceOpen
                    ? namespace.packages.map((pkg) => {
                        const packageKey = `pkg:${namespace.id}:${pkg.id}`
                        const packageOpen = expanded.has(packageKey)
                        return (
                          <div key={pkg.id}>
                            <TreeRow
                              depth={1}
                              open={packageOpen}
                              icon={<Box className="size-3.5" />}
                              label={pkg.alias ?? pkg.id}
                              hint={pkg.disabled ? 'no pipelines' : undefined}
                              muted={pkg.disabled}
                              onClick={() => toggle(packageKey)}
                            />
                            {packageOpen ? (
                              <div className="space-y-0.5">
                                {pkg.entry ? (
                                  <LeafRow
                                    depth={2}
                                    leaf={pkg.entry}
                                    selected={selected === pkg.entry.ref}
                                    onSelect={onSelect}
                                  />
                                ) : null}
                                {pkg.pipelines.map((leaf) => (
                                  <LeafRow
                                    key={leaf.ref}
                                    depth={2}
                                    leaf={leaf}
                                    selected={selected === leaf.ref}
                                    onSelect={onSelect}
                                  />
                                ))}
                                {pkg.wrappers.map((leaf) => (
                                  <LeafRow
                                    key={leaf.ref}
                                    depth={2}
                                    leaf={leaf}
                                    selected={selected === leaf.ref}
                                    onSelect={onSelect}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    : null}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}

function TreeRow({
  depth,
  open,
  icon,
  label,
  hint,
  muted,
  onClick,
}: {
  depth: number
  open: boolean
  icon: ReactNode
  label: string
  hint?: string
  muted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs hover:bg-accent',
        muted ? 'text-muted-foreground' : 'text-foreground'
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
      aria-expanded={open}
    >
      {open ? (
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {hint ? <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span> : null}
    </button>
  )
}

function LeafRow({
  depth,
  leaf,
  selected,
  onSelect,
}: {
  depth: number
  leaf: PipelineLeaf
  selected: boolean
  onSelect: (ref: string) => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs',
        selected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      style={{ paddingLeft: 6 + depth * 14 + 12 }}
      onClick={() => onSelect(leaf.ref)}
      title={leaf.description ?? leaf.name}
    >
      {leaf.kind === 'entry' ? (
        <Route className="size-3.5 shrink-0" />
      ) : leaf.kind === 'wrapper' ? (
        <Wrench className="size-3.5 shrink-0 text-amber-500" />
      ) : (
        <Workflow className="size-3.5 shrink-0" />
      )}
      <span className="shrink-0 font-medium text-foreground/90">{leaf.id}</span>
      {leaf.kind === 'entry' ? null : (
        <span className="min-w-0 truncate text-[11px]">{leaf.name}</span>
      )}
    </button>
  )
}
