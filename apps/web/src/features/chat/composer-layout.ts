import type { ComposerMode } from '@/features/chat/composer-session'

/** The composer's window mode plus whether it is docked to the chat bottom. */
export type ComposerWindow = {
  mode: ComposerMode
  pinned: boolean
}

/** Pinning is a normal-size placement; it leaves a closed window closed. */
export function pinComposer(window: ComposerWindow): ComposerWindow {
  return { mode: window.mode === 'closed' ? 'closed' : 'normal', pinned: true }
}

/** Unpinning returns to the remembered floating window size. */
export function unpinComposer(size: 'normal' | 'maximized'): ComposerWindow {
  return { mode: size, pinned: false }
}

/** Minimizing leaves the dock and returns to the floating window states. */
export function minimizeComposer(): ComposerWindow {
  return { mode: 'minimized', pinned: false }
}

/** Maximizing leaves the dock and opens the existing overlay. */
export function maximizeComposer(): ComposerWindow {
  return { mode: 'maximized', pinned: false }
}

/** Restoring a minimized or maximized window returns to the floating size. */
export function restoreComposer(size: 'normal' | 'maximized'): ComposerWindow {
  return { mode: size, pinned: false }
}

/** Opening uses the dock when it was pinned, otherwise the saved float size. */
export function openComposerWindow(pinned: boolean, size: 'normal' | 'maximized'): ComposerWindow {
  return { mode: pinned ? 'normal' : size, pinned }
}

/** Docking only exists at normal size; min and max always float. */
export function composerDocked(window: ComposerWindow): boolean {
  return window.pinned && window.mode === 'normal'
}
