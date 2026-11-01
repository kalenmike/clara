import { describe, expect, it } from 'vitest'
import { isTextEntryTarget } from './keyboard'

function target(input: { tagName?: string; isContentEditable?: boolean }): EventTarget {
  return input as unknown as EventTarget
}

describe('isTextEntryTarget', () => {
  it('detects fields that accept text entry', () => {
    expect(isTextEntryTarget(target({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isTextEntryTarget(target({ tagName: 'INPUT' }))).toBe(true)
    expect(isTextEntryTarget(target({ tagName: 'SELECT' }))).toBe(true)
  })

  it('detects contenteditable hosts', () => {
    expect(isTextEntryTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('ignores the rest of the page', () => {
    expect(isTextEntryTarget(target({ tagName: 'DIV' }))).toBe(false)
    expect(isTextEntryTarget(target({ tagName: 'BODY' }))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
