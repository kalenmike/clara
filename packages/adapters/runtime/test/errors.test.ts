import { describe, expect, it } from 'vitest'
import { describeError, isConnectionFailure } from '../src/errors'

describe('describeError', () => {
  it('keeps the message and code from a socket error', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8788'), {
      code: 'ECONNREFUSED',
    })
    expect(describeError(cause)).toBe('connect ECONNREFUSED 127.0.0.1:8788')
  })

  it('reads the nested cause of an ErrorEvent', () => {
    const event = {
      type: 'error',
      error: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8788'), {
        code: 'ECONNREFUSED',
      }),
    }
    expect(describeError(event)).toBe('connect ECONNREFUSED 127.0.0.1:8788')
  })

  it('never returns the ErrorEvent object string', () => {
    expect(describeError({ type: 'error' })).toBe('WebSocket error')
  })
})

describe('isConnectionFailure', () => {
  it('recognizes an ErrorEvent with a refused connection', () => {
    expect(
      isConnectionFailure({
        type: 'error',
        error: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8788'), {
          code: 'ECONNREFUSED',
        }),
      })
    ).toBe(true)
  })

  it('ignores an enrollment rejection', () => {
    expect(isConnectionFailure(new Error('The adapter is not paired'))).toBe(false)
  })
})
