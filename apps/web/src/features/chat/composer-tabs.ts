import type { ComposerTarget } from '@/features/chat/composer-session'
import type { PromptFile } from '@/features/chat/use-chat'

export type ComposerTab = ComposerTarget

/** Unsent text and attachments for one composer tab. */
export type ComposerDraft = {
  text: string
  files: PromptFile[]
}

/** Only text or attachments keep a tab alive when the route moves on. */
export function hasComposerInput(draft: ComposerDraft | undefined): boolean {
  return Boolean(draft && (draft.text.trim().length > 0 || draft.files.length > 0))
}

export function ensureComposerTab(
  tabs: readonly ComposerTab[],
  target: ComposerTarget
): ComposerTab[] {
  if (tabs.some((tab) => tab.sessionID === target.sessionID)) return tabs as ComposerTab[]
  return [...tabs, target]
}

export function removeComposerTab(tabs: readonly ComposerTab[], sessionID: string): ComposerTab[] {
  return tabs.filter((tab) => tab.sessionID !== sessionID)
}

/**
 * Leaving a session drops its tab unless that session's composer has input.
 * The session being entered always keeps a tab.
 */
export function leaveComposerTab(input: {
  tabs: readonly ComposerTab[]
  leaving: ComposerTarget
  hasInput: boolean
  next: ComposerTarget
}): ComposerTab[] {
  const tabs = input.hasInput ? input.tabs : removeComposerTab(input.tabs, input.leaving.sessionID)
  return ensureComposerTab(tabs, input.next)
}

/** The session on screen cannot lose its tab; every other tab can be closed. */
export function canCloseComposerTab(
  tab: ComposerTab,
  currentSessionID: string | undefined
): boolean {
  return tab.sessionID !== currentSessionID
}

/**
 * Tabs are restored from local storage only when their draft still exists in
 * that browser. The current route always gets a tab even without a draft.
 */
export function pruneComposerTabs(
  tabs: readonly ComposerTab[],
  currentSessionID: string | undefined,
  hasStoredDraft: (sessionID: string) => boolean
): ComposerTab[] {
  const kept: ComposerTab[] = []
  const seen = new Set<string>()
  for (const tab of tabs) {
    if (seen.has(tab.sessionID)) continue
    if (tab.sessionID !== currentSessionID && !hasStoredDraft(tab.sessionID)) continue
    seen.add(tab.sessionID)
    kept.push(tab)
  }
  return kept
}

function isComposerTab(value: unknown): value is ComposerTab {
  if (typeof value !== 'object' || value === null) return false
  const tab = value as Record<string, unknown>
  if (typeof tab.sessionID !== 'string' || tab.sessionID.trim().length === 0) return false
  if (tab.projectID !== undefined && typeof tab.projectID !== 'string') return false
  return true
}

export function parseComposerTabs(raw: string | null): ComposerTab[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const tabs: ComposerTab[] = []
    const seen = new Set<string>()
    for (const entry of value) {
      if (!isComposerTab(entry) || seen.has(entry.sessionID)) continue
      seen.add(entry.sessionID)
      tabs.push({ sessionID: entry.sessionID, projectID: entry.projectID })
    }
    return tabs
  } catch {
    return []
  }
}

export function serializeComposerTabs(tabs: readonly ComposerTab[]): string {
  return JSON.stringify(tabs.map(({ sessionID, projectID }) => ({ sessionID, projectID })))
}
