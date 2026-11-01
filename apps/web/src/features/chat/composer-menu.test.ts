import { describe, expect, it } from 'vitest'
import { composerMenuMode } from './composer-menu'

describe('composerMenuMode', () => {
  it('waits for the message history before offering an action', () => {
    expect(composerMenuMode({ ready: false, busy: false, hasAssistant: false })).toBeNull()
    expect(composerMenuMode({ ready: false, busy: true, hasAssistant: false })).toBeNull()
  })

  it('offers a draft before the first assistant reply', () => {
    expect(composerMenuMode({ ready: true, busy: false, hasAssistant: false })).toBe('draft')
  })

  it('offers a queued send while a run is active', () => {
    expect(composerMenuMode({ ready: true, busy: true, hasAssistant: false })).toBe('queue')
    expect(composerMenuMode({ ready: true, busy: true, hasAssistant: true })).toBe('queue')
  })

  it('offers nothing once an idle session has a reply', () => {
    expect(composerMenuMode({ ready: true, busy: false, hasAssistant: true })).toBeNull()
  })
})
