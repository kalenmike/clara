import { describe, expect, it } from 'vitest'
import { ATTENTION_KINDS } from './attention'
import { allInboxSoundKinds } from './settings'

describe('allInboxSoundKinds', () => {
  it('enables every Inbox state', () => {
    const kinds = allInboxSoundKinds(true)
    expect(Object.keys(kinds).sort()).toEqual([...ATTENTION_KINDS].sort())
    for (const kind of ATTENTION_KINDS) expect(kinds[kind]).toBe(true)
  })

  it('disables every Inbox state', () => {
    const kinds = allInboxSoundKinds(false)
    for (const kind of ATTENTION_KINDS) expect(kinds[kind]).toBe(false)
  })

  it('returns a fresh object each time', () => {
    expect(allInboxSoundKinds(true)).not.toBe(allInboxSoundKinds(true))
  })
})
