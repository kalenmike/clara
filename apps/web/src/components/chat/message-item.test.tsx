import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionMessageUser } from '@opencode/client'
import { MessageItem } from '@/components/chat/message-item'

function userMessage(text: string): SessionMessageUser {
  return { id: 'user-1', type: 'user', time: { created: 1 }, text }
}

function renderUser(text: string) {
  return renderToStaticMarkup(
    <MessageItem message={userMessage(text)} streaming={false} showInternal={false} />
  )
}

describe('user message markdown', () => {
  it('renders markdown in a saved prompt', () => {
    const html = renderUser('**bold** and `code` with [a link](https://example.com)')

    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code')
    expect(html).toContain('href="https://example.com"')
  })

  it('preserves single line breaks in a saved prompt', () => {
    const html = renderUser('first line\nsecond line')

    expect(html).toMatch(/first line<br\s*\/?>\s*second line/)
  })

  it('shows raw HTML-looking prompt text without parsing it', () => {
    const html = renderUser('use <div> here')

    expect(html).toContain('&lt;div&gt;')
  })
})
