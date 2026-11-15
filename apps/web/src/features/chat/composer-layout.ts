import type { ComposerMode } from '@/features/chat/composer-session'

/**
 * The composer has three shapes: the pinned dock at the bottom of the chat, a
 * fullscreen panel, and a minimized header. Collapsing remembers the expanded
 * shape to restore, while expanding always targets fullscreen.
 */
export type ExpandedComposerMode = Exclude<ComposerMode, 'minimized'>

export type ComposerLayout = {
  mode: ComposerMode
  expanded: ExpandedComposerMode
}

export const COMPOSER_LAYOUT_DEFAULT: ComposerLayout = {
  mode: 'pinned',
  expanded: 'pinned',
}

export type ComposerAutoHideState = {
  enabled: boolean
  pinned: boolean
  revealed: boolean
}

/** Maximize from pinned or minimized, and dock from maximized. */
export function expandComposer(layout: ComposerLayout): ComposerLayout {
  const mode: ExpandedComposerMode = layout.mode === 'maximized' ? 'pinned' : 'maximized'
  return { mode, expanded: mode }
}

/** Collapse to the header, remembering the expanded shape to restore. */
export function minimizeComposer(layout: ComposerLayout): ComposerLayout {
  if (layout.mode === 'minimized') return layout
  return { mode: 'minimized', expanded: layout.mode }
}

/** Restoring a minimized header uses the last expanded shape. */
export function restoreComposer(layout: ComposerLayout): ComposerLayout {
  if (layout.mode !== 'minimized') return layout
  return { mode: layout.expanded, expanded: layout.expanded }
}

/** The chevron collapses an expanded composer and restores a minimized one. */
export function toggleComposerCollapse(layout: ComposerLayout): ComposerLayout {
  return layout.mode === 'minimized' ? restoreComposer(layout) : minimizeComposer(layout)
}

/**
 * The shape actually on screen when auto-hide is active. A maximized composer
 * never hides, and revealing a minimized one restores its last expanded shape.
 */
export function autoHideComposerMode(
  layout: ComposerLayout,
  state: ComposerAutoHideState
): ComposerMode {
  if (!state.enabled || layout.mode === 'maximized') return layout.mode
  return state.pinned || state.revealed ? restoreComposer(layout).mode : 'minimized'
}
