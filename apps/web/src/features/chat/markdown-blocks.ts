/**
 * The structure behind the reply inspector. Markdown stays the source of truth
 * for forwarding: a selection is a character range in one text part, so the
 * forwarded draft keeps its lists, fences, and inline formatting exactly.
 */

export type MarkdownRange = {
  start: number
  end: number
}

export type MarkdownBlock = MarkdownRange & {
  /** Rendered tag, used for labels and heading detection. */
  tag: string
  /** Heading depth for h1..h6. */
  level?: number
  /** First line of the block, without markdown heading markers. */
  label: string
}

export type OutlineNode = MarkdownRange & {
  kind: 'root' | 'section' | 'block'
  tag?: string
  level?: number
  label: string
  children: OutlineNode[]
}

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

export function headingLevel(tag: string): number | undefined {
  return HEADING_LEVELS[tag]
}

export function isHeading(block: MarkdownBlock): boolean {
  return Boolean(block.level ?? headingLevel(block.tag))
}

/** Turn the rendered top-level blocks into headings with their section bodies. */
export function buildOutline(blocks: readonly MarkdownBlock[], sourceLength: number): OutlineNode {
  const root: OutlineNode = {
    kind: 'root',
    start: 0,
    end: Math.max(0, sourceLength),
    label: '',
    children: [],
  }
  const stack: OutlineNode[] = [root]

  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(block.start) || !Number.isFinite(block.end)) continue
    if (block.start < 0 || block.end < block.start) continue

    const level = block.level ?? headingLevel(block.tag)
    if (level) {
      while (stack.length > 1) {
        const top = stack[stack.length - 1]
        if ((top.level ?? 0) >= level) {
          stack.pop()
          const parent = stack[stack.length - 1]
          parent.end = Math.max(parent.end, top.end)
        } else break
      }

      const section: OutlineNode = {
        kind: 'section',
        start: block.start,
        end: block.end,
        tag: block.tag,
        level,
        label: block.label,
        children: [],
      }
      const parent = stack[stack.length - 1]
      parent.children.push(section)
      parent.end = Math.max(parent.end, section.end)
      stack.push(section)
    } else {
      const parent = stack[stack.length - 1]
      parent.children.push({
        kind: 'block',
        start: block.start,
        end: block.end,
        tag: block.tag,
        label: block.label,
        children: [],
      })
      parent.end = Math.max(parent.end, block.end)
    }
  }

  while (stack.length > 1) {
    const top = stack.pop()
    const parent = stack[stack.length - 1]
    if (top) parent.end = Math.max(parent.end, top.end)
  }

  return root
}

/** The section whose heading starts at this offset. */
export function sectionByStart(outline: OutlineNode, start: number): OutlineNode | undefined {
  for (const child of outline.children) {
    if (child.kind !== 'section') continue
    if (child.start === start) return child
    const nested = sectionByStart(child, start)
    if (nested) return nested
  }
  return undefined
}

/**
 * Clicking a heading selects its whole section; clicking any other block
 * selects that block alone.
 */
export function rangeForBlock(outline: OutlineNode, block: MarkdownBlock): MarkdownRange {
  if (isHeading(block)) {
    const section = sectionByStart(outline, block.start)
    if (section) return { start: section.start, end: section.end }
  }
  return { start: block.start, end: block.end }
}

export function containsRange(outer: MarkdownRange, inner: MarkdownRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end
}

export function sameRange(a: MarkdownRange, b: MarkdownRange): boolean {
  return a.start === b.start && a.end === b.end
}

export function unionRange(a: MarkdownRange, b: MarkdownRange): MarkdownRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
}

export function rangeLength(range: MarkdownRange): number {
  return Math.max(0, range.end - range.start)
}

function deepestContainer(node: OutlineNode, range: MarkdownRange): OutlineNode | undefined {
  for (const child of node.children) {
    if (!containsRange(child, range) || sameRange(child, range)) continue
    return deepestContainer(child, range) ?? child
  }
  return undefined
}

/** The next larger selection: block → subsection → section → whole part. */
export function expandRange(outline: OutlineNode, range: MarkdownRange): MarkdownRange | null {
  if (sameRange(range, outline)) return null
  const container = deepestContainer(outline, range)
  if (container) return { start: container.start, end: container.end }
  return { start: outline.start, end: outline.end }
}

/** Headings that enclose the selection, outermost first. */
export function sectionPath(outline: OutlineNode, range: MarkdownRange): OutlineNode[] {
  const path: OutlineNode[] = []
  let node: OutlineNode = outline

  while (true) {
    const next = node.children.find(
      (child) => child.kind === 'section' && containsRange(child, range)
    )
    if (!next) break
    path.push(next)
    node = next
  }

  return path
}

export function blocksInRange(
  blocks: readonly MarkdownBlock[],
  range: MarkdownRange
): MarkdownBlock[] {
  return blocks.filter((block) => block.start >= range.start && block.end <= range.end)
}

/** The exact markdown for the selection, ready to prefill a draft. */
export function sliceSelection(source: string, range: MarkdownRange): string {
  const start = Math.max(0, Math.min(source.length, range.start))
  const end = Math.max(start, Math.min(source.length, range.end))
  return source.slice(start, end).trim()
}

export function tagLabel(tag: string): string {
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'Section'
    case 'p':
      return 'Paragraph'
    case 'ul':
    case 'ol':
      return 'List'
    case 'blockquote':
      return 'Quote'
    case 'pre':
    case 'code':
      return 'Code'
    case 'table':
      return 'Table'
    case 'hr':
      return 'Divider'
    default:
      return 'Block'
  }
}

/** A short, human label for the current selection. */
export function describeSelection(
  outline: OutlineNode,
  blocks: readonly MarkdownBlock[],
  range: MarkdownRange
): string {
  if (sameRange(range, outline)) return 'Whole reply part'

  const section = sectionByStart(outline, range.start)
  if (section && sameRange(section, range)) {
    return section.label || `Section ${section.level}`
  }

  const selected = blocksInRange(blocks, range)
  if (selected.length === 1 && sameRange(selected[0], range)) {
    return tagLabel(selected[0].tag)
  }
  return `${selected.length} blocks`
}

/** A single-line title for the new brief created from a selection. */
export function selectionTitle(text: string): string {
  const line =
    text
      .split('\n')
      .map((value) => value.trim())
      .find((value) => value.length > 0) ?? ''

  return (
    line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^```[^\s]*\s*/, '')
      .replace(/[*_`~]/g, '')
      .trim() || 'Forwarded selection'
  )
}
