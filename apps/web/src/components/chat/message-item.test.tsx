import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ClaraSessionMessageUser } from '@clara/api-contract'
import { MessageItem } from '@/components/chat/message-item'

function userMessage(text: string): ClaraSessionMessageUser {
  return { id: 'user-1', type: 'user', time: { created: 1 }, text }
}

function userMessageWithFile(name: string): ClaraSessionMessageUser {
  return {
    id: 'user-1',
    type: 'user',
    time: { created: 1 },
    text: 'see attached',
    files: [{ name, data: '', mime: 'image/png', source: { type: 'inline' } }],
  }
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

describe('message row layout', () => {
  it('spans the row with its collapse trigger, not the message text', () => {
    const html = renderToStaticMarkup(
      <MessageItem
        message={userMessage('short')}
        streaming={false}
        showInternal={false}
        collapsed
        onToggle={() => {}}
      />
    )

    expect(html).toMatch(/<button[^>]*class="[^"]*\bw-full\b[^"]*"/)
  })
})

describe('user message attachments', () => {
  it('caps a long attachment name instead of widening the transcript', () => {
    const name = `${'a'.repeat(120)}.png`
    const html = renderToStaticMarkup(
      <MessageItem message={userMessageWithFile(name)} streaming={false} showInternal={false} />
    )

    expect(html).toContain('max-w-full')
    expect(html).toMatch(/<span class="[^"]*truncate[^"]*">[^<]*\.png<\/span>/)
    expect(html).toContain(`title="${name}"`)
  })
})
