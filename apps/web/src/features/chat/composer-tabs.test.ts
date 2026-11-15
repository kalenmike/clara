import { describe, expect, it } from 'vitest'
import {
  canCloseComposerTab,
  ensureComposerTab,
  hasComposerInput,
  leaveComposerTab,
  parseComposerTabs,
  pruneComposerTabs,
  removeComposerTab,
  serializeComposerTabs,
  type ComposerTab,
} from './composer-tabs'

const A: ComposerTab = { sessionID: 'session-a', projectID: 'project-1' }
const B: ComposerTab = { sessionID: 'session-b', projectID: 'project-1' }
const C: ComposerTab = { sessionID: 'session-c', projectID: 'project-2' }

describe('composer tabs', () => {
  it('appends a session once and keeps the array identity when it exists', () => {
    expect(ensureComposerTab([], A)).toEqual([A])
    expect(ensureComposerTab([A], B)).toEqual([A, B])
    const tabs = [A, B]
    expect(ensureComposerTab(tabs, B)).toBe(tabs)
  })

  it('removes a tab without touching the others', () => {
    expect(removeComposerTab([A, B, C], B.sessionID)).toEqual([A, C])
  })

  it('keeps the left session only while it has input', () => {
    expect(leaveComposerTab({ tabs: [A], leaving: A, hasInput: true, next: B })).toEqual([A, B])
    expect(leaveComposerTab({ tabs: [A, B], leaving: A, hasInput: false, next: B })).toEqual([B])
  })

  it('never leaves the entered session without a tab', () => {
    expect(leaveComposerTab({ tabs: [A], leaving: A, hasInput: false, next: C })).toEqual([C])
  })

  it('lets every tab but the session on screen close', () => {
    expect(canCloseComposerTab(A, 'session-a')).toBe(false)
    expect(canCloseComposerTab(B, 'session-a')).toBe(true)
    expect(canCloseComposerTab(A, undefined)).toBe(true)
  })

  it('counts text or attachments as input', () => {
    expect(hasComposerInput(undefined)).toBe(false)
    expect(hasComposerInput({ text: '', files: [] })).toBe(false)
    expect(hasComposerInput({ text: '  ', files: [] })).toBe(false)
    expect(hasComposerInput({ text: 'hello', files: [] })).toBe(true)
    expect(
      hasComposerInput({ text: '', files: [{ uri: 'data:text/plain,hi', name: 'hi.txt' }] })
    ).toBe(true)
  })
})

describe('composer tab persistence', () => {
  it('restores only tabs with a stored draft plus the current session', () => {
    expect(
      pruneComposerTabs([A, B, C], 'session-c', (sessionID) => sessionID === 'session-b')
    ).toEqual([B, C])
  })

  it('drops duplicates', () => {
    expect(pruneComposerTabs([A, B, A], undefined, () => true)).toEqual([A, B])
  })

  it('parses stored tabs and ignores malformed entries', () => {
    const raw = JSON.stringify([A, { sessionID: '' }, { projectID: 'project-1' }, 'nope', B, A])
    expect(parseComposerTabs(raw)).toEqual([A, B])
    expect(parseComposerTabs('{')).toEqual([])
    expect(parseComposerTabs(null)).toEqual([])
  })

  it('round-trips tabs and drops unknown fields', () => {
    const tabs = [A, B]
    expect(parseComposerTabs(serializeComposerTabs(tabs))).toEqual(tabs)
  })
})
