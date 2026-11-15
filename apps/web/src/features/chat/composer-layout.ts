import type { ComposerMode } from '@/features/chat/composer-session'

/**
 * The composer has three shapes: the pinned dock at the bottom of the chat, a
 * fullscreen panel, and a minimized header. Pinned and maximized remember which
 * one to return to after minimizing.
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

/** Maximize from pinned, return to pinned from maximized, restore from minimized. */
export function expandComposer(layout: ComposerLayout): ComposerLayout {
  if (layout.mode === 'minimized') {
    return { mode: layout.expanded, expanded: layout.expanded }
  }
  const mode: ExpandedComposerMode = layout.mode === 'maximized' ? 'pinned' : 'maximized'
  return { mode, expanded: mode }
}

export function minimizeComposer(layout: ComposerLayout): ComposerLayout {
  return { mode: 'minimized', expanded: layout.expanded }
}

/** Restoring a minimized header uses the last expanded shape. */
export function restoreComposer(layout: ComposerLayout): ComposerLayout {
  if (layout.mode !== 'minimized') return layout
  return { mode: layout.expanded, expanded: layout.expanded }
}
