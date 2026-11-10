import { describe, expect, it } from 'vitest'
import { resolveDeleteFocusTarget } from './delete-focus'

const before = ['a', 'b', 'c', 'd', 'e']

describe('resolveDeleteFocusTarget', () => {
  it('picks the first surviving row after a middle deletion', () => {
    expect(resolveDeleteFocusTarget(before, ['a', 'b', 'd', 'e'], new Set(['c']))).toBe('d')
  })

  it('falls back to the previous row when the deletion reaches the end', () => {
    expect(resolveDeleteFocusTarget(before, ['a', 'b', 'c', 'd'], new Set(['e']))).toBe('d')
  })

  it('picks the next row when the deletion starts the list', () => {
    expect(resolveDeleteFocusTarget(before, ['b', 'c', 'd', 'e'], new Set(['a']))).toBe('b')
  })

  it('skips a consecutive deleted range', () => {
    expect(resolveDeleteFocusTarget(before, ['a', 'd', 'e'], new Set(['b', 'c']))).toBe('d')
  })

  it('uses the next survivor after a non-contiguous range', () => {
    expect(resolveDeleteFocusTarget(before, ['a', 'c', 'e'], new Set(['b', 'd']))).toBe('e')
  })

  it('falls back before a non-contiguous range when nothing follows it', () => {
    expect(resolveDeleteFocusTarget(before, ['a', 'c'], new Set(['b', 'd']))).toBe('a')
  })

  it('skips rows that disappeared from the rendered order', () => {
    expect(resolveDeleteFocusTarget(before, ['a'], new Set(['b']))).toBe('a')
  })

  it('follows the pre-deletion order when the rendered order changes', () => {
    expect(resolveDeleteFocusTarget(before, ['e', 'a', 'b', 'd'], new Set(['c']))).toBe('d')
  })

  it('ignores rows that were not present before the deletion', () => {
    expect(resolveDeleteFocusTarget(['a', 'b', 'c'], ['a', 'new', 'c'], new Set(['b']))).toBe('c')
  })

  it('returns null when every row was deleted', () => {
    expect(resolveDeleteFocusTarget(['a', 'b'], [], new Set(['a', 'b']))).toBeNull()
  })

  it('returns null for an empty pre-deletion order', () => {
    expect(resolveDeleteFocusTarget([], ['a'], new Set())).toBeNull()
  })

  it('returns null when the deleted IDs are not in the pre-deletion order', () => {
    expect(resolveDeleteFocusTarget(before, before, new Set(['missing']))).toBeNull()
  })

  it('returns a survivor before falling back to null', () => {
    expect(resolveDeleteFocusTarget(['a', 'b', 'c'], ['a'], new Set(['b', 'c']))).toBe('a')
  })
})
