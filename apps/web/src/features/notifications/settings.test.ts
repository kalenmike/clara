import { describe, expect, it } from 'vitest'
import { ATTENTION_KINDS } from './attention'
import { DEFAULT_SOUND_VOLUME, allInboxSoundKinds, simplifiedInboxSoundPatch } from './settings'

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

describe('simplifiedInboxSoundPatch', () => {
  it('enables every Inbox state and restores the default volume', () => {
    const patch = simplifiedInboxSoundPatch(true)
    expect(patch.sounds).toBe(true)
    expect(patch.volume).toBe(DEFAULT_SOUND_VOLUME)
    for (const kind of ATTENTION_KINDS) expect(patch.soundKinds?.[kind]).toBe(true)
  })

  it('mutes every Inbox state without touching the volume', () => {
    const patch = simplifiedInboxSoundPatch(false)
    expect(patch.sounds).toBe(false)
    expect(patch).not.toHaveProperty('volume')
    for (const kind of ATTENTION_KINDS) expect(patch.soundKinds?.[kind]).toBe(false)
  })
})
