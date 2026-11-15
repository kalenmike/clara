import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_TAB,
  PANEL_TABS,
  PANEL_TAB_IDS,
  panelTabFromHash,
  panelTabMeta,
} from './tabs.ts'

describe('panelTabFromHash', () => {
  it('reads a known tab with or without the hash marker', () => {
    expect(panelTabFromHash('#traffic')).toBe('traffic')
    expect(panelTabFromHash('clients')).toBe('clients')
    expect(panelTabFromHash('#sessions')).toBe('sessions')
  })

  it('falls back to the overview for unknown or empty hashes', () => {
    expect(panelTabFromHash('')).toBe(DEFAULT_PANEL_TAB)
    expect(panelTabFromHash('#')).toBe(DEFAULT_PANEL_TAB)
    expect(panelTabFromHash('#nope')).toBe(DEFAULT_PANEL_TAB)
  })

  it('ignores trailing path or query segments', () => {
    expect(panelTabFromHash('#harness/extra')).toBe('harness')
    expect(panelTabFromHash('#settings?tab=sync')).toBe('settings')
  })

  it('trims surrounding whitespace', () => {
    expect(panelTabFromHash('# activity ')).toBe('activity')
  })
})

describe('panel tab metadata', () => {
  it('keeps every id unique and resolves each tab', () => {
    expect(new Set(PANEL_TAB_IDS).size).toBe(PANEL_TABS.length)
    for (const tab of PANEL_TABS) {
      expect(panelTabMeta(tab.id)).toBe(tab)
    }
  })

  it('keeps settings in the rail footer and the rest in the main group', () => {
    expect(PANEL_TABS.filter((tab) => !tab.primary).map((tab) => tab.id)).toEqual(['settings'])
  })

  it('gives every tab a label, title, and description', () => {
    for (const tab of PANEL_TABS) {
      expect(tab.label.length).toBeGreaterThan(0)
      expect(tab.title.length).toBeGreaterThan(0)
      expect(tab.description.length).toBeGreaterThan(0)
    }
  })
})
