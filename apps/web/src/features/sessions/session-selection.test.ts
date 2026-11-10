import { describe, expect, it } from 'vitest'
import type { SelectionState } from './session-selection'

const ordered = [
  'inbox-2',
  'inbox-1',
  'outbox-1',
  'drafts-1',
  'snoozed-1',
  'archived-1',
  'worker-1',
]

function selection(ids: string[], anchorID: string | null): SelectionState {
  return { anchorID, selectedIDs: new Set(ids) }
}

async function selectionModule() {
  return import('./session-selection')
}

describe('selectRange', () => {
  it('selects the inclusive forward range in rendered order', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'inbox-1', 'snoozed-1')

    expect(result.anchorID).toBe('inbox-1')
    expect(result.selectedIDs).toEqual(new Set(['inbox-1', 'outbox-1', 'drafts-1', 'snoozed-1']))
  })

  it('selects the same inclusive range in reverse', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'snoozed-1', 'inbox-1')

    expect(result.anchorID).toBe('snoozed-1')
    expect(result.selectedIDs).toEqual(new Set(['inbox-1', 'outbox-1', 'drafts-1', 'snoozed-1']))
  })

  it('selects only the anchor when the target is the anchor', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'outbox-1', 'outbox-1')

    expect(result.anchorID).toBe('outbox-1')
    expect(result.selectedIDs).toEqual(new Set(['outbox-1']))
  })

  it('starts a new anchor at the target when no anchor exists', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, null, 'drafts-1')

    expect(result.anchorID).toBe('drafts-1')
    expect(result.selectedIDs).toEqual(new Set(['drafts-1']))
  })

  it('starts a new anchor at the target when the anchor is no longer rendered', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'missing-anchor', 'archived-1')

    expect(result.anchorID).toBe('archived-1')
    expect(result.selectedIDs).toEqual(new Set(['archived-1']))
  })

  it('selects only the target when the target is not rendered', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'inbox-2', 'missing-target')

    expect(result.anchorID).toBe('missing-target')
    expect(result.selectedIDs).toEqual(new Set(['missing-target']))
  })

  it('follows caller-provided section order across mailbox and worker sections', async () => {
    const { selectRange } = await selectionModule()

    const result = selectRange(ordered, 'outbox-1', 'worker-1')

    expect(result.anchorID).toBe('outbox-1')
    expect(result.selectedIDs).toEqual(
      new Set(['outbox-1', 'drafts-1', 'snoozed-1', 'archived-1', 'worker-1'])
    )
  })
})

describe('pruneSelection', () => {
  it('returns the same reference when every selected ID and the anchor remain available', async () => {
    const { pruneSelection } = await selectionModule()
    const current = selection(['inbox-1', 'outbox-1'], 'outbox-1')

    expect(pruneSelection(current, new Set(['inbox-1', 'outbox-1', 'worker-1']))).toBe(current)
  })

  it('drops selected IDs that are no longer available and keeps an available anchor', async () => {
    const { pruneSelection } = await selectionModule()
    const current = selection(['inbox-1', 'outbox-1', 'worker-1'], 'outbox-1')

    const result = pruneSelection(current, new Set(['outbox-1', 'worker-1']))

    expect(result.anchorID).toBe('outbox-1')
    expect(result.selectedIDs).toEqual(new Set(['outbox-1', 'worker-1']))
  })

  it('drops the anchor when its row disappears while other selected rows survive', async () => {
    const { pruneSelection } = await selectionModule()
    const current = selection(['inbox-1', 'outbox-1'], 'inbox-1')

    const result = pruneSelection(current, new Set(['outbox-1']))

    expect(result.anchorID).toBeNull()
    expect(result.selectedIDs).toEqual(new Set(['outbox-1']))
  })

  it('returns an empty selection when nothing remains', async () => {
    const { pruneSelection } = await selectionModule()
    const current = selection(['inbox-1', 'outbox-1'], 'inbox-1')

    const result = pruneSelection(current, new Set())

    expect(result.anchorID).toBeNull()
    expect(result.selectedIDs.size).toBe(0)
  })
})
