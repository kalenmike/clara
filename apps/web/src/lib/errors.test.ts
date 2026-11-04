import { describe, expect, it } from 'vitest'
import { errorMessage, errorStack } from './errors'

describe('errorMessage', () => {
  it('reads the message from an Error', () => {
    expect(errorMessage(new Error('socket closed'))).toBe('socket closed')
  })

  it('reads a message from a message-like object', () => {
    expect(errorMessage({ message: 'request failed' })).toBe('request failed')
  })

  it('falls back for values without a message', () => {
    expect(errorMessage('offline')).toBe('Unknown error')
    expect(errorMessage(null)).toBe('Unknown error')
  })
})

describe('errorStack', () => {
  it('returns the stack from an Error', () => {
    const error = new Error('boom')
    expect(errorStack(error)).toBe(error.stack)
  })

  it('reads a stack from a stack-like object', () => {
    expect(errorStack({ stack: 'at render' })).toBe('at render')
  })

  it('ignores values without a usable stack', () => {
    expect(errorStack({ stack: 42 })).toBeUndefined()
    expect(errorStack('boom')).toBeUndefined()
  })
})
