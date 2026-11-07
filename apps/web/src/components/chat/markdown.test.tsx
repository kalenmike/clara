import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '@/components/chat/markdown'

function render(markdown: string) {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>)
}

describe('Markdown code blocks', () => {
  it('renders an untagged fence as a pre block with preserved newlines', () => {
    const html = render('```\n+---+\n| a |\n+---+\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('+---+\n| a |\n+---+')
    expect(html).toContain('>text<')
  })

  it('renders a text-tagged fence with its language', () => {
    const html = render('```text\n+---+\n| a |\n+---+\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('>text<')
  })

  it('keeps languages the old regex rejected', () => {
    const html = render('```c++\nint x = 1;\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('>c++<')
  })

  it('keeps inline code inline', () => {
    const html = render('use `pnpm test` here')
    expect(html).not.toContain('<pre')
    expect(html).toContain('pnpm test')
  })
})

describe('Markdown line breaks', () => {
  it('keeps single newlines soft by default', () => {
    const html = render('first line\nsecond line')
    expect(html).toContain('first line\nsecond line')
    expect(html).not.toContain('<br')
  })

  it('turns single newlines into breaks when breaks is enabled', () => {
    const html = renderToStaticMarkup(<Markdown breaks>{'first line\nsecond line'}</Markdown>)
    expect(html).toMatch(/first line<br\s*\/?>\s*second line/)
  })
})
