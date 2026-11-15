import { describe, expect, it } from 'vitest'
import { claraVersionLabel } from '../src/version.ts'

describe('claraVersionLabel', () => {
  it('names each surface and keeps the version intact', () => {
    expect(claraVersionLabel('web', '0.1.0-dev+abc1234')).toBe('Clara Web · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('pwa', '0.1.0-dev+abc1234')).toBe('Clara PWA · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('desktop', '0.1.0-dev+abc1234')).toBe(
      'Clara Desktop · 0.1.0-dev+abc1234'
    )
    expect(claraVersionLabel('hub', '0.1.0-dev+abc1234')).toBe('Clara Hub · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('lab', '0.1.0-dev+abc1234')).toBe('Clara Lab · 0.1.0-dev+abc1234')
  })

  it('preserves a release version without a dev suffix', () => {
    expect(claraVersionLabel('hub', '1.2.3')).toBe('Clara Hub · 1.2.3')
  })
})
