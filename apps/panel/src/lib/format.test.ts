import { describe, expect, it } from 'vitest'
import { formatBytes } from './format.ts'

describe('formatBytes', () => {
  it('floors byte-scale values to whole bytes', () => {
    expect(formatBytes(317.284631)).toBe('317 B')
    expect(formatBytes(0.9)).toBe('0 B')
    expect(formatBytes(1_023.99)).toBe('1023 B')
  })

  it('keeps whole byte values unchanged', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('scales up at the kilobyte boundary', () => {
    expect(formatBytes(1_024)).toBe('1.0 KB')
    expect(formatBytes(10_240)).toBe('10 KB')
  })

  it('reports missing or invalid values as a dash', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
