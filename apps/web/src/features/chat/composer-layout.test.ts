import { describe, expect, it } from 'vitest'
import {
  composerDocked,
  maximizeComposer,
  minimizeComposer,
  openComposerWindow,
  pinComposer,
  restoreComposer,
  unpinComposer,
} from './composer-layout'

describe('composer pin transitions', () => {
  it('docks any open window at normal size', () => {
    expect(pinComposer({ mode: 'normal', pinned: false })).toEqual({
      mode: 'normal',
      pinned: true,
    })
    expect(pinComposer({ mode: 'minimized', pinned: false })).toEqual({
      mode: 'normal',
      pinned: true,
    })
    expect(pinComposer({ mode: 'maximized', pinned: false })).toEqual({
      mode: 'normal',
      pinned: true,
    })
  })

  it('keeps a closed window closed while remembering the pin', () => {
    expect(pinComposer({ mode: 'closed', pinned: false })).toEqual({
      mode: 'closed',
      pinned: true,
    })
  })

  it('unpins to the remembered floating size', () => {
    expect(unpinComposer('normal')).toEqual({ mode: 'normal', pinned: false })
    expect(unpinComposer('maximized')).toEqual({ mode: 'maximized', pinned: false })
  })

  it('leaves the dock when minimizing or maximizing', () => {
    expect(minimizeComposer()).toEqual({ mode: 'minimized', pinned: false })
    expect(maximizeComposer()).toEqual({ mode: 'maximized', pinned: false })
  })

  it('restores to the remembered floating size', () => {
    expect(restoreComposer('normal')).toEqual({ mode: 'normal', pinned: false })
    expect(restoreComposer('maximized')).toEqual({ mode: 'maximized', pinned: false })
  })

  it('opens a pinned window docked and a floating one at its saved size', () => {
    expect(openComposerWindow(true, 'maximized')).toEqual({ mode: 'normal', pinned: true })
    expect(openComposerWindow(false, 'maximized')).toEqual({ mode: 'maximized', pinned: false })
  })

  it('is docked only at normal size', () => {
    expect(composerDocked({ mode: 'normal', pinned: true })).toBe(true)
    expect(composerDocked({ mode: 'minimized', pinned: true })).toBe(false)
    expect(composerDocked({ mode: 'maximized', pinned: true })).toBe(false)
    expect(composerDocked({ mode: 'normal', pinned: false })).toBe(false)
  })
})
