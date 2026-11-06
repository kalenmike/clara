import { describe, expect, it } from 'vitest'
import {
  blocksInRange,
  buildOutline,
  describeSelection,
  expandRange,
  rangeForBlock,
  sameRange,
  sectionByStart,
  sectionPath,
  selectionTitle,
  sliceSelection,
  tagLabel,
  unionRange,
  type MarkdownBlock,
} from '@/features/chat/markdown-blocks'

const source = [
  '# Title',
  '',
  'Intro paragraph.',
  '',
  '## Setup',
  '',
  'Install it.',
  '',
  '### Step one',
  '',
  'Run the thing.',
  '',
  '## Usage',
  '',
  '- one',
  '- two',
].join('\n')

function at(text: string): { start: number; end: number } {
  const start = source.indexOf(text)
  if (start === -1) throw new Error(`missing fixture text: ${text}`)
  return { start, end: start + text.length }
}

function block(tag: string, text: string, level?: number): MarkdownBlock {
  const range = at(text)
  return { ...range, tag, level, label: text.replace(/^#+\s*/, '') }
}

const blocks: MarkdownBlock[] = [
  block('h1', '# Title', 1),
  block('p', 'Intro paragraph.'),
  block('h2', '## Setup', 2),
  block('p', 'Install it.'),
  block('h3', '### Step one', 3),
  block('p', 'Run the thing.'),
  block('h2', '## Usage', 2),
  block('ul', '- one\n- two'),
]

const outline = buildOutline(blocks, source.length)

describe('buildOutline', () => {
  it('nests sections by heading level', () => {
    const h1 = outline.children[0]
    expect(h1.kind).toBe('section')
    expect(h1.level).toBe(1)
    expect(h1.start).toBe(0)
    expect(h1.end).toBe(source.length)

    expect(h1.children.map((node) => node.kind)).toEqual(['block', 'section', 'section'])

    const setup = h1.children[1]
    expect(setup.label).toBe('Setup')
    expect(setup.children.map((node) => node.label)).toEqual(['Install it.', 'Step one'])

    const usage = h1.children[2]
    expect(usage.start).toBe(at('## Usage').start)
    expect(usage.end).toBe(source.length)
  })

  it('ends a section at its last child, before the next heading', () => {
    const setup = sectionByStart(outline, at('## Setup').start)
    expect(setup?.end).toBe(at('Run the thing.').end)
  })

  it('ignores a skipped heading level without losing the section', () => {
    const blocks = [
      { start: 0, end: 4, tag: 'h1', level: 1, label: 'A' },
      { start: 5, end: 9, tag: 'h3', level: 3, label: 'C' },
      { start: 10, end: 14, tag: 'h2', level: 2, label: 'B' },
    ] as MarkdownBlock[]
    const tree = buildOutline(blocks, 15)
    expect(tree.children.map((node) => node.label)).toEqual(['A'])
    expect(tree.children[0].children.map((node) => node.label)).toEqual(['C', 'B'])
  })
})

describe('selection ranges', () => {
  it('selects a heading with its whole section', () => {
    const range = rangeForBlock(outline, blocks[2])
    expect(range).toEqual({ start: at('## Setup').start, end: at('Run the thing.').end })
  })

  it('selects a paragraph alone', () => {
    const range = rangeForBlock(outline, blocks[3])
    expect(range).toEqual(at('Install it.'))
  })

  it('selects a whole list as one block', () => {
    const range = rangeForBlock(outline, blocks[7])
    expect(range).toEqual(at('- one\n- two'))
  })

  it('expands a paragraph to its subsection, section, and part', () => {
    const paragraph = at('Run the thing.')
    const subsection = expandRange(outline, paragraph)
    expect(subsection).toEqual(at('### Step one\n\nRun the thing.'))

    const section = subsection ? expandRange(outline, subsection) : null
    expect(section).toEqual({
      start: at('## Setup').start,
      end: at('Run the thing.').end,
    })

    const part = section ? expandRange(outline, section) : null
    expect(part).toEqual({ start: 0, end: source.length })

    const beyond = part ? expandRange(outline, part) : null
    expect(beyond).toBeNull()
  })

  it('reports enclosing headings outermost first', () => {
    const path = sectionPath(outline, at('Run the thing.'))
    expect(path.map((node) => node.label)).toEqual(['Title', 'Setup', 'Step one'])
  })

  it('unions two ranges', () => {
    expect(unionRange({ start: 4, end: 8 }, { start: 1, end: 6 })).toEqual({ start: 1, end: 8 })
  })

  it('finds only blocks fully inside a range', () => {
    const range = { start: at('## Setup').start, end: at('## Usage').start }
    expect(blocksInRange(blocks, range).map((item) => item.label)).toEqual([
      'Setup',
      'Install it.',
      'Step one',
      'Run the thing.',
    ])
  })
})

describe('selection text', () => {
  it('slices the source exactly and trims padding', () => {
    const range = { start: at('## Setup').start, end: at('## Usage').start }
    expect(sliceSelection(source, range)).toBe(
      '## Setup\n\nInstall it.\n\n### Step one\n\nRun the thing.'
    )
  })

  it('keeps fenced code intact', () => {
    const fenced = '```ts\nconst value = 1\n```'
    expect(sliceSelection(fenced, { start: 0, end: fenced.length })).toBe(fenced)
  })

  it('clamps ranges to the source', () => {
    expect(sliceSelection('abc', { start: 2, end: 99 })).toBe('c')
    expect(sliceSelection('abc', { start: 99, end: 120 })).toBe('')
  })

  it('describes sections, blocks, and the whole part', () => {
    const setup = at('## Setup')
    expect(
      describeSelection(outline, blocks, { start: setup.start, end: at('Run the thing.').end })
    ).toBe('Setup')
    expect(describeSelection(outline, blocks, at('Install it.'))).toBe('Paragraph')
    expect(describeSelection(outline, blocks, { start: 0, end: source.length })).toBe(
      'Whole reply part'
    )
  })

  it('labels tags for the inspector', () => {
    expect(tagLabel('h3')).toBe('Section')
    expect(tagLabel('ul')).toBe('List')
    expect(tagLabel('pre')).toBe('Code')
    expect(tagLabel('aside')).toBe('Block')
  })

  it('derives a clean title from the first line', () => {
    expect(selectionTitle('## Install the plugin\n\nRun it.')).toBe('Install the plugin')
    expect(selectionTitle('- first item\n- second')).toBe('first item')
    expect(selectionTitle('> quoted')).toBe('quoted')
    expect(selectionTitle('**bold** start')).toBe('bold start')
    expect(selectionTitle('   \n  ')).toBe('Forwarded selection')
  })

  it('compares ranges', () => {
    expect(sameRange({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true)
    expect(sameRange({ start: 1, end: 2 }, { start: 1, end: 3 })).toBe(false)
  })
})
