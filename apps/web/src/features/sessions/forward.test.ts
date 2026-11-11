import { describe, expect, it } from 'vitest'
import type { ClaraSessionMessageAssistant, ClaraSessionMessageUser } from '@clara/api-contract'
import {
  canForwardMessage,
  forwardFiles,
  forwardText,
  forwardTitle,
  forwardTitleFromText,
} from './forward'

function user(
  id: string,
  text: string,
  created = 1,
  files?: ClaraSessionMessageUser['files']
): ClaraSessionMessageUser {
  return { id, type: 'user', time: { created }, text, files }
}

function assistant(
  id: string,
  content: ClaraSessionMessageAssistant['content'],
  created = 2
): ClaraSessionMessageAssistant {
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

describe('forwardTitleFromText', () => {
  it('strips heading markers from a selected section', () => {
    expect(forwardTitleFromText('## Install the plugin\n\nRun it.')).toBe('Install the plugin')
  })

  it('strips list and quote markers from the first line', () => {
    expect(forwardTitleFromText('- first item\n- second')).toBe('first item')
    expect(forwardTitleFromText('> quoted')).toBe('quoted')
  })

  it('falls back when the selection has no readable line', () => {
    expect(forwardTitleFromText('   \n\n')).toBe('Forwarded selection')
  })

  it('shortens long selections like a draft title', () => {
    expect(forwardTitleFromText('## ' + 'a'.repeat(80))).toBe(`${'a'.repeat(50)}…`)
  })
})
