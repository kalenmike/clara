import { describe, expect, it } from 'vitest'
import type { SessionMessageAssistant, SessionMessageUser } from '@opencode/client'
import { canForwardMessage, forwardFiles, forwardText, forwardTitle } from './forward'

function user(
  id: string,
  text: string,
  created = 1,
  files?: SessionMessageUser['files']
): SessionMessageUser {
  return { id, type: 'user', time: { created }, text, files }
}

function assistant(
  id: string,
  content: SessionMessageAssistant['content'],
  created = 2
): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

describe('forwardText', () => {
  it('uses a user prompt as-is', () => {
    expect(forwardText(user('user-1', 'hello'))).toBe('hello')
  })

  it('joins assistant text parts and skips reasoning and tools', () => {
    const reply = assistant('assistant-1', [
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'First paragraph' },
      {
        type: 'tool',
        id: 'tool-1',
        name: 'bash',
        state: { status: 'streaming', input: '' },
        time: { created: 1 },
      },
      { type: 'text', text: 'Second paragraph' },
    ])

    expect(forwardText(reply)).toBe('First paragraph\n\nSecond paragraph')
  })

  it('returns an empty string for tool-only assistant turns', () => {
    const reply = assistant('assistant-1', [
      {
        type: 'tool',
        id: 'tool-1',
        name: 'bash',
        state: { status: 'streaming', input: '' },
        time: { created: 1 },
      },
    ])

    expect(forwardText(reply)).toBe('')
    expect(canForwardMessage(reply)).toBe(false)
  })
})

describe('forwardFiles', () => {
  it('maps inline attachments to data URLs', () => {
    const files = forwardFiles(
      user('user-1', '', 1, [
        {
          data: 'aGVsbG8=',
          mime: 'text/plain',
          source: { type: 'inline' },
          name: 'hello.txt',
        },
      ])
    )

    expect(files).toEqual([{ uri: 'data:text/plain;base64,aGVsbG8=', name: 'hello.txt' }])
  })

  it('keeps URI-backed attachment sources', () => {
    const files = forwardFiles(
      user('user-1', '', 1, [
        {
          data: '',
          mime: 'image/png',
          source: { type: 'uri', uri: 'file:///tmp/image.png' },
          name: 'image.png',
        },
      ])
    )

    expect(files).toEqual([{ uri: 'file:///tmp/image.png', name: 'image.png' }])
  })

  it('has no files for assistant messages', () => {
    expect(forwardFiles(assistant('assistant-1', [{ type: 'text', text: 'hi' }]))).toEqual([])
  })
})

describe('forwardTitle', () => {
  it('derives a short title from the forwarded text', () => {
    expect(forwardTitle(user('user-1', 'Design   a new\nfork flow'))).toBe('Design a new fork flow')
  })

  it('falls back to the first attachment name', () => {
    expect(
      forwardTitle(
        user('user-1', '', 1, [
          {
            data: 'aGVsbG8=',
            mime: 'text/plain',
            source: { type: 'inline' },
            name: 'notes.txt',
          },
        ])
      )
    ).toBe('notes.txt')
  })
})
