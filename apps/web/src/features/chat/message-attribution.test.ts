import { describe, expect, it } from 'vitest'
import type { ClaraSessionMessage } from '@clara/api-contract'
import { isSyntheticMessage } from './message-attribution'

function user(metadata?: ClaraSessionMessage['metadata']): ClaraSessionMessage {
  return {
    id: 'msg_1',
    type: 'user',
    time: { created: 1 },
    text: 'handoff',
    metadata,
  } as ClaraSessionMessage
}

describe('isSyntheticMessage', () => {
  it('reads the synthetic marker from a user message', () => {
    expect(isSyntheticMessage(user())).toBe(false)
    expect(isSyntheticMessage(user({ synthetic: 'true' }))).toBe(false)
    expect(isSyntheticMessage(user({ synthetic: true }))).toBe(true)
  })

  it('ignores non-user messages', () => {
    expect(
      isSyntheticMessage({
        id: 'msg_2',
        type: 'assistant',
        time: { created: 1 },
        metadata: { synthetic: true },
        agent: 'build',
        model: { id: 'model', providerID: 'provider' },
        content: [],
      } as ClaraSessionMessage)
    ).toBe(false)
  })
})
