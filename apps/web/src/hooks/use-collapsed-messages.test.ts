import { describe, expect, it } from 'vitest'
import { toggledCollapseState } from '@/hooks/use-collapsed-messages'

const ids = ['message-1', 'message-2', 'message-3']

describe('toggledCollapseState', () => {
  it('folds every message when all are open', () => {
    expect(toggledCollapseState(ids, new Set())).toEqual(new Set(ids))
  })

  it('folds every message when only some are folded', () => {
    expect(toggledCollapseState(ids, new Set(['message-1']))).toEqual(new Set(ids))
  })

  it('folds the remaining messages when the last one is open', () => {
    expect(toggledCollapseState(ids, new Set(['message-1', 'message-2']))).toEqual(new Set(ids))
  })

  it('expands every message when all are folded', () => {
    expect(toggledCollapseState(ids, new Set(ids))).toEqual(new Set())
  })

  it('does nothing when there is no collapsible message', () => {
    expect(toggledCollapseState([], new Set())).toEqual(new Set())
  })
})
