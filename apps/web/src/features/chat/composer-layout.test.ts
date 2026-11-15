import { describe, expect, it } from 'vitest'
import {
  COMPOSER_LAYOUT_DEFAULT,
  autoHideComposerMode,
  expandComposer,
  minimizeComposer,
  restoreComposer,
  toggleComposerCollapse,
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

  it('expands a minimized composer to fullscreen', () => {
    expect(expandComposer({ mode: 'minimized', expanded: 'pinned' })).toEqual({
      mode: 'maximized',
      expanded: 'maximized',
    })
    expect(expandComposer({ mode: 'minimized', expanded: 'maximized' })).toEqual({
      mode: 'maximized',
      expanded: 'maximized',
    })
  })

  it('minimizes without forgetting the expanded shape', () => {
    const minimized = minimizeComposer({ mode: 'maximized', expanded: 'maximized' })
    expect(minimized).toEqual({ mode: 'minimized', expanded: 'maximized' })
    expect(restoreComposer(minimized)).toEqual({ mode: 'maximized', expanded: 'maximized' })
  })

  it('collapses and restores both expanded shapes through the chevron', () => {
    const pinned = { mode: 'pinned' as const, expanded: 'pinned' as const }
    const fullscreen = { mode: 'maximized' as const, expanded: 'maximized' as const }

    expect(toggleComposerCollapse(pinned)).toEqual({ mode: 'minimized', expanded: 'pinned' })
    expect(toggleComposerCollapse(fullscreen)).toEqual({ mode: 'minimized', expanded: 'maximized' })
    expect(toggleComposerCollapse({ mode: 'minimized', expanded: 'pinned' })).toEqual(pinned)
    expect(toggleComposerCollapse({ mode: 'minimized', expanded: 'maximized' })).toEqual(fullscreen)
  })

  it('treats restore as a no-op for an expanded composer', () => {
    const pinned = { mode: 'pinned' as const, expanded: 'pinned' as const }
    expect(restoreComposer(pinned)).toBe(pinned)
  })
})

describe('composer auto-hide', () => {
  const pinned = { mode: 'pinned' as const, expanded: 'pinned' as const }
  const maximized = { mode: 'maximized' as const, expanded: 'maximized' as const }

  it('leaves the layout alone when auto-hide is off', () => {
    expect(autoHideComposerMode(pinned, { enabled: false, pinned: false, revealed: false })).toBe(
      'pinned'
    )
  })

  it('keeps the dock collapsed until the pointer or focus reveals it', () => {
    expect(autoHideComposerMode(pinned, { enabled: true, pinned: false, revealed: false })).toBe(
      'minimized'
    )
    expect(autoHideComposerMode(pinned, { enabled: true, pinned: false, revealed: true })).toBe(
      'pinned'
    )
  })

  it('stays open while pinned or revealed', () => {
    expect(autoHideComposerMode(pinned, { enabled: true, pinned: true, revealed: false })).toBe(
      'pinned'
    )
    expect(autoHideComposerMode(pinned, { enabled: true, pinned: true, revealed: true })).toBe(
      'pinned'
    )
  })

  it('never hides a maximized composer', () => {
    expect(autoHideComposerMode(maximized, { enabled: true, pinned: false, revealed: false })).toBe(
      'maximized'
    )
  })

  it('restores the expanded shape when a collapsed composer is revealed', () => {
    const collapsed = minimizeComposer(maximized)
    expect(autoHideComposerMode(collapsed, { enabled: true, pinned: false, revealed: true })).toBe(
      'maximized'
    )
    expect(autoHideComposerMode(collapsed, { enabled: true, pinned: true, revealed: false })).toBe(
      'maximized'
    )
  })
})
