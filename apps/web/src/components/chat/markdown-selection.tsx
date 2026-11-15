/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp, Forward, TextSelect, X } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import {
  buildOutline,
  describeSelection,
  expandRange,
  headingLevel,
  rangeForBlock,
  sameRange,
  sectionPath,
  sliceSelection,
  tagLabel,
  unionRange,
  type MarkdownBlock,
  type MarkdownRange,
  type OutlineNode,
} from '@/features/chat/markdown-blocks'
import { cn } from '@clara/ui/lib/utils'

type PartBlock = MarkdownBlock & { element: HTMLElement }

type RegisteredPart = {
  source: string
  element: HTMLElement
  blocks: PartBlock[]
  outline: OutlineNode
}

type ReplySelection = MarkdownRange & { part: number }

type SelectionContextValue = {
  active: boolean
  register: (index: number, source: string, element: HTMLElement | null) => (() => void) | undefined
  move: (index: number, event: PointerEvent<HTMLElement>) => void
  leave: (index: number) => void
  select: (index: number, event: MouseEvent<HTMLElement>) => void
  key: (index: number, event: KeyboardEvent<HTMLElement>) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

const SELECTED = 'data-md-selected'
const PREVIEW = 'data-md-preview'

function topLevelElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute('data-md-start')
  )
}

function readPart(source: string, element: HTMLElement): RegisteredPart {
  const blocks: PartBlock[] = []

  for (const child of topLevelElements(element)) {
    const start = Number(child.dataset.mdStart)
    const end = Number(child.dataset.mdEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue

    const tag = child.dataset.mdTag || child.tagName.toLowerCase()
    const level = Number(child.dataset.mdLevel) || headingLevel(tag)
    const text =
      (tag === 'code' || tag === 'pre'
        ? child.querySelector('pre')?.textContent
        : child.textContent) ?? ''
    const label = text.replace(/\s+/g, ' ').trim().slice(0, 80)
    const block: PartBlock = { start, end, tag, level, label, element: child }

    child.tabIndex = 0
    child.setAttribute('role', 'button')
    child.setAttribute('data-md-selectable', 'true')
    child.setAttribute('aria-label', `${tagLabel(tag)}${label ? `: ${label}` : ''}`)

    blocks.push(block)
  }

  return { source, element, blocks, outline: buildOutline(blocks, source.length) }
}

function hoverBlock(part: RegisteredPart, target: EventTarget | null): PartBlock | null {
  if (!(target instanceof Element)) return null
  let node: Element | null = target
  while (node && node.parentElement !== part.element) node = node.parentElement
  if (!node || !part.element.contains(node)) return null
  return part.blocks.find((block) => block.element === node) ?? null
}

function paint(
  part: RegisteredPart | undefined,
  attribute: string,
  range: MarkdownRange | null
): void {
  if (!part) return
  for (const block of part.blocks) {
    if (range && block.start >= range.start && block.end <= range.end) {
      block.element.setAttribute(attribute, 'true')
    } else {
      block.element.removeAttribute(attribute)
    }
  }
}

export function MarkdownSelectionProvider({
  active,
  onExit,
  onForward,
  children,
}: {
  active: boolean
  onExit: () => void
  onForward: (text: string) => void
  children: ReactNode
}) {
  const parts = useRef(new Map<number, RegisteredPart>())
  const previewRef = useRef<{ part: number; range: MarkdownRange } | null>(null)
  const selectionRef = useRef<ReplySelection | null>(null)
  const [selection, setSelection] = useState<ReplySelection | null>(null)
  const [hover, setHover] = useState<{ label: string; top: number; left: number } | null>(null)

  const updateSelection = useCallback((next: ReplySelection | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

  const register = useCallback((index: number, source: string, element: HTMLElement | null) => {
    const previous = parts.current.get(index)
    if (previous) {
      for (const block of previous.blocks) {
        block.element.removeAttribute('data-md-selectable')
        block.element.removeAttribute('role')
        block.element.removeAttribute('tabindex')
        block.element.removeAttribute('aria-label')
        block.element.removeAttribute(SELECTED)
        block.element.removeAttribute(PREVIEW)
      }
    }

    if (!element) {
      parts.current.delete(index)
      return
    }

    parts.current.set(index, readPart(source, element))
    return () => {
      const part = parts.current.get(index)
      if (!part) return
      for (const block of part.blocks) {
        block.element.removeAttribute('data-md-selectable')
        block.element.removeAttribute('role')
        block.element.removeAttribute('tabindex')
        block.element.removeAttribute('aria-label')
        block.element.removeAttribute(SELECTED)
        block.element.removeAttribute(PREVIEW)
      }
      parts.current.delete(index)
    }
  }, [])

  const clearPreview = useCallback(() => {
    const current = previewRef.current
    if (current) {
      paint(parts.current.get(current.part), PREVIEW, null)
      previewRef.current = null
    }
    setHover((value) => (value === null ? value : null))
  }, [])

  const move = useCallback(
    (index: number, event: PointerEvent<HTMLElement>) => {
      const part = parts.current.get(index)
      if (!part) return

      const block = hoverBlock(part, event.target)
      if (!block) {
        clearPreview()
        return
      }
      if (previewRef.current?.part === index && previewRef.current.range.start === block.start)
        return

      const previous = previewRef.current
      paint(previous ? parts.current.get(previous.part) : undefined, PREVIEW, null)
      const range = rangeForBlock(part.outline, block)
      paint(part, PREVIEW, range)
      previewRef.current = { part: index, range }

      const rect = block.element.getBoundingClientRect()
      const above = rect.top > 44
      setHover({
        label: block.level ? `Section · ${block.label}` : tagLabel(block.tag),
        top: above ? rect.top - 30 : rect.bottom + 6,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - 220),
      })
    },
    [clearPreview]
  )

  const leave = useCallback(
    (index: number) => {
      if (previewRef.current?.part === index) clearPreview()
    },
    [clearPreview]
  )

  const applyBlock = useCallback(
    (index: number, block: PartBlock, extend: boolean) => {
      const part = parts.current.get(index)
      if (!part) return

      const clicked = rangeForBlock(part.outline, block)
      const current = selectionRef.current
      const next = extend && current?.part === index ? unionRange(current, clicked) : clicked
      updateSelection({ part: index, ...next })
      clearPreview()
    },
    [clearPreview, updateSelection]
  )

  const select = useCallback(
    (index: number, event: MouseEvent<HTMLElement>) => {
      const part = parts.current.get(index)
      if (!part) return
      const block = hoverBlock(part, event.target)
      if (!block) return
      const target = event.target
      if (target instanceof Element && target.closest('a, button')) event.preventDefault()
      applyBlock(index, block, event.shiftKey)
    },
    [applyBlock]
  )

  const key = useCallback(
    (index: number, event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const part = parts.current.get(index)
      if (!part) return
      const block = hoverBlock(part, event.target)
      if (!block) return

      event.preventDefault()
      event.stopPropagation()
      applyBlock(index, block, event.shiftKey)
    },
    [applyBlock]
  )

  const exit = useCallback(() => {
    updateSelection(null)
    clearPreview()
    onExit()
  }, [clearPreview, onExit, updateSelection])

  useEffect(() => {
    if (!active) return
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      exit()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, exit])

  useEffect(() => {
    if (active) return
    for (const part of parts.current.values()) {
      paint(part, SELECTED, null)
      paint(part, PREVIEW, null)
    }
    previewRef.current = null
    selectionRef.current = null
    setSelection((value) => (value === null ? value : null))
    setHover((value) => (value === null ? value : null))
  }, [active])

  useEffect(() => {
    for (const part of parts.current.values()) paint(part, SELECTED, null)
    if (!selection) return
    paint(parts.current.get(selection.part), SELECTED, selection)
  }, [selection])

  const value = useMemo<SelectionContextValue>(
    () => ({ active, register, move, leave, select, key }),
    [active, key, leave, move, register, select]
  )

  const part = selection ? parts.current.get(selection.part) : undefined
  const path = part && selection ? sectionPath(part.outline, selection) : []
  const description =
    part && selection ? describeSelection(part.outline, part.blocks, selection) : ''
  const summary = description === path[path.length - 1]?.label ? '' : description
  const text = part && selection ? sliceSelection(part.source, selection) : ''
  const atWholePart = Boolean(part && selection && sameRange(part.outline, selection))

  const expand = () => {
    if (!part || !selection) return
    const next = expandRange(part.outline, selection)
    if (next) updateSelection({ part: selection.part, ...next })
  }

  const forward = () => {
    if (!text) return
    updateSelection(null)
    clearPreview()
    onForward(text)
  }

  return (
    <SelectionContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            {active && hover && !selection ? (
              <div
                className="pointer-events-none fixed z-50 max-w-56 truncate rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md"
                style={{ top: hover.top, left: hover.left }}
              >
                {hover.label}
              </div>
            ) : null}

            {active && !selection ? (
              <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-3 md:bottom-6">
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover/95 py-1 pr-1 pl-3 text-xs shadow-md backdrop-blur">
                  <TextSelect className="size-3.5 text-muted-foreground" />
                  <span>Click a block or section to select</span>
                  <span className="text-muted-foreground">· Esc to cancel</span>
                  <Button type="button" variant="ghost" size="sm" onClick={exit}>
                    <X className="size-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {active && selection && part ? (
              <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-3 md:bottom-6">
                <div className="pointer-events-auto flex max-w-[min(100%,44rem)] flex-col gap-1.5 rounded-xl border bg-popover/95 p-2 shadow-lg backdrop-blur">
                  {path.length > 0 ? (
                    <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 text-[11px]">
                      {path.map((node, index) => (
                        <span key={node.start} className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateSelection({
                                part: selection.part,
                                start: node.start,
                                end: node.end,
                              })
                            }
                            className={cn(
                              'max-w-40 truncate rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                              sameRange(node, selection) && 'bg-accent text-foreground'
                            )}
                            title={`Select ${node.label}`}
                          >
                            {node.label}
                          </button>
                          {index < path.length - 1 ? (
                            <span className="text-muted-foreground/50">›</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 px-1 text-xs">
                      {summary ? (
                        <span
                          className={path.length === 0 ? 'font-medium' : 'text-muted-foreground'}
                        >
                          {summary}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {summary ? ' · ' : ''}
                        {text.length.toLocaleString()} chars
                      </span>
                    </div>

                    <Button type="button" variant="ghost" size="sm" onClick={exit}>
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={expand}
                      disabled={atWholePart}
                    >
                      <ChevronUp className="size-3.5" />
                      Expand
                    </Button>
                    <Button type="button" size="sm" onClick={forward} disabled={!text}>
                      <Forward className="size-3.5" />
                      Forward selection
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>,
          document.body
        )}
    </SelectionContext.Provider>
  )
}

export function useMarkdownSelection(): SelectionContextValue | null {
  return useContext(SelectionContext)
}
