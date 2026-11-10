import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@/features/chat/timeline'
import { stepMessageIndex } from '@/features/chat/message-navigation'

function message(key: string): TimelineItem {
  return {
    type: 'message',
    key,
    message: { id: key, type: 'user', time: { created: 1 }, text: key },
  }
}

function event(key: string): TimelineItem {
  return {
    type: 'event',
    key,
    event: { id: key, kind: 'plan-request', label: 'Requested a plan', time: 1 },
  }
}

const items = [message('a'), event('e1'), message('b'), event('e2'), message('c')]

describe('stepMessageIndex', () => {
  it('steps down to the next message row', () => {
    expect(stepMessageIndex(items, 0, 'down')).toBe(2)
    expect(stepMessageIndex(items, 2, 'down')).toBe(4)
  })

  it('steps up to the previous message row', () => {
    expect(stepMessageIndex(items, 4, 'up')).toBe(2)
    expect(stepMessageIndex(items, 2, 'up')).toBe(0)
  })

  it('returns null when no message remains in the direction', () => {
    expect(stepMessageIndex(items, 4, 'down')).toBeNull()
    expect(stepMessageIndex(items, 0, 'up')).toBeNull()
  })

  it('clamps indexes outside the timeline', () => {
    expect(stepMessageIndex(items, -1, 'down')).toBe(0)
    expect(stepMessageIndex(items, items.length, 'up')).toBe(4)
    expect(stepMessageIndex([], 0, 'down')).toBeNull()
  })
})
