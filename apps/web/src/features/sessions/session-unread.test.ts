import { describe, expect, it } from 'vitest'
import { isSessionUnread } from './session-unread'

describe('isSessionUnread', () => {
  it('treats a completed turn without a viewed marker as unread', () => {
    expect(isSessionUnread({ time: { created: 1, updated: 2, idle: 2 } })).toBe(true)
  })

  it('treats a newer idle transition as unread', () => {
    expect(isSessionUnread({ time: { created: 1, updated: 3, idle: 3, viewed: 2 } })).toBe(true)
  })

  it('treats the current idle transition as read', () => {
    expect(isSessionUnread({ time: { created: 1, updated: 2, idle: 2, viewed: 2 } })).toBe(false)
  })

  it('treats a session without an idle transition as read', () => {
    expect(isSessionUnread({ time: { created: 1, updated: 1 } })).toBe(false)
  })
})
