import { describe, expect, it } from 'vitest'
import { harnessLabel } from './harness-label'

function info(label: string) {
  return { harness: { active: { label } } }
}

describe('harnessLabel', () => {
  it('uses the active harness label', () => {
    expect(harnessLabel(info('OpenCode'))).toBe('OpenCode')
    expect(harnessLabel(info('  Pi  '))).toBe('Pi')
  })

  it('falls back when no harness is active', () => {
    expect(harnessLabel(null)).toBe('your harness')
    expect(harnessLabel({ harness: { active: null } })).toBe('your harness')
    expect(harnessLabel(info(''), 'the harness')).toBe('the harness')
  })
})
