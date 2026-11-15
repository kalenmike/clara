/**
 * The send menu holds the actions that are not the primary Send. They are
 * contextual: a draft can be saved or deleted, a busy run can queue, an idle
 * session can be marked done, and an archived session can be reopened.
 */
export type ComposerAction = 'done' | 'save-draft' | 'queue' | 'delete-empty' | 'reopen'

export function composerActions(input: {
  ready: boolean
  hasSession: boolean
  busy: boolean
  empty: boolean
  archived: boolean
  snoozed: boolean
  hasText: boolean
  canSaveDraft: boolean
}): ComposerAction[] {
  if (!input.ready || !input.hasSession) return []
  const actions: ComposerAction[] = []

  if (input.busy) {
    if (input.hasText) actions.push('queue')
    return actions
  }

  if (input.archived || input.snoozed) {
    actions.push('reopen')
    return actions
  }

  if (input.empty) {
    actions.push('delete-empty')
  } else {
    actions.push('done')
  }

  if (input.canSaveDraft && input.hasText) actions.unshift('save-draft')

  return actions
}
