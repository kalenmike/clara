import { describe, expect, it } from 'vitest'
import {
  COMPOSER_LAYOUT_DEFAULT,
  expandComposer,
  minimizeComposer,
  restoreComposer,
} from './composer-layout'

describe('composer layout transitions', () => {
  it('starts pinned in the chat column', () => {
    expect(COMPOSER_LAYOUT_DEFAULT).toEqual({ mode: 'pinned', expanded: 'pinned' })
  })

  it('expands pinned to fullscreen and back', () => {
    const fullscreen = expandComposer({ mode: 'pinned', expanded: 'pinned' })
    expect(fullscreen).toEqual({ mode: 'maximized', expanded: 'maximized' })
    expect(expandComposer(fullscreen)).toEqual({ mode: 'pinned', expanded: 'pinned' })
  })

  it('minimizes without forgetting the expanded shape', () => {
    const minimized = minimizeComposer({ mode: 'maximized', expanded: 'maximized' })
    expect(minimized).toEqual({ mode: 'minimized', expanded: 'maximized' })
    expect(restoreComposer(minimized)).toEqual({ mode: 'maximized', expanded: 'maximized' })
  })

  it('restores a minimized header to the last expanded shape', () => {
    expect(expandComposer({ mode: 'minimized', expanded: 'pinned' })).toEqual({
      mode: 'pinned',
      expanded: 'pinned',
    })
    expect(expandComposer({ mode: 'minimized', expanded: 'maximized' })).toEqual({
      mode: 'maximized',
      expanded: 'maximized',
    })
  })

  it('treats restore as a no-op for an expanded composer', () => {
    const pinned = { mode: 'pinned' as const, expanded: 'pinned' as const }
    expect(restoreComposer(pinned)).toBe(pinned)
  })
})
