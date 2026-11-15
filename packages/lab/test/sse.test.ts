import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createSseParser } from '../src/useLab'

describe('createSseParser', () => {
  it('parses a named event with JSON data', () => {
    const parser = createSseParser()
    const messages = parser.push('event: snapshot\ndata: {"seq":0,"type":"snapshot"}\n\n')
    expect(messages).toEqual([
      { event: 'snapshot', data: '{"seq":0,"type":"snapshot"}', id: null, retry: null },
    ])
  })

  it('defaults the event name and joins multi-line data', () => {
    const parser = createSseParser()
    const messages = parser.push('data: first\ndata: second\n\n')
    expect(messages).toEqual([{ event: 'message', data: 'first\nsecond', id: null, retry: null }])
  })

  it('reads id and retry fields', () => {
    const parser = createSseParser()
    const messages = parser.push('id: 42\nretry: 1500\ndata: {}\n\n')
    expect(messages).toEqual([{ event: 'message', data: '{}', id: '42', retry: 1500 }])
  })

  it('reports a retry-only block and stays silent for comments', () => {
    const parser = createSseParser()
    expect(parser.push('retry: 1000\n\n')).toEqual([
      { event: 'message', data: '', id: null, retry: 1000 },
    ])
    expect(parser.push(': heartbeat\n\n')).toEqual([])
  })

  it('buffers events split across chunks', () => {
    const parser = createSseParser()
    expect(parser.push('event: call\nda')).toEqual([])
    expect(parser.push('ta: {"seq":1}')).toEqual([])
    expect(parser.push('\n\n')).toEqual([
      { event: 'call', data: '{"seq":1}', id: null, retry: null },
    ])
  })

  it('accepts CRLF framing and strips a leading BOM', () => {
    const parser = createSseParser()
    const messages = parser.push('\uFEFFevent: state\r\ndata: {"a":1}\r\n\r\n')
    expect(messages).toEqual([{ event: 'state', data: '{"a":1}', id: null, retry: null }])
  })

  it('keeps colon-prefixed data values intact', () => {
    const parser = createSseParser()
    const messages = parser.push('event: event\ndata: {"at":"12:00:00"}\n\n')
    expect(messages).toEqual([{ event: 'event', data: '{"at":"12:00:00"}', id: null, retry: null }])
  })
})

describe('the lab stream reader', () => {
  it('does not use EventSource', async () => {
    const source = await readFile(new URL('../src/useLab.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('EventSource')
  })
})
