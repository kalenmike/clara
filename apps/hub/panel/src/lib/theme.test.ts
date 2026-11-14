import { describe, expect, it } from 'vitest'
import { isPanelThemeMode, resolvePanelTheme } from './theme.ts'

describe('isPanelThemeMode', () => {
  it('accepts the supported modes', () => {
    expect(isPanelThemeMode('light')).toBe(true)
    expect(isPanelThemeMode('dark')).toBe(true)
    expect(isPanelThemeMode('system')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isPanelThemeMode('nord')).toBe(false)
    expect(isPanelThemeMode('')).toBe(false)
    expect(isPanelThemeMode(undefined)).toBe(false)
  })
})

describe('resolvePanelTheme', () => {
  it('keeps explicit light and dark choices', () => {
    expect(resolvePanelTheme('light', true)).toBe('light')
    expect(resolvePanelTheme('dark', false)).toBe('dark')
  })

  it('follows the system preference in system mode', () => {
    expect(resolvePanelTheme('system', true)).toBe('dark')
    expect(resolvePanelTheme('system', false)).toBe('light')
  })
})
