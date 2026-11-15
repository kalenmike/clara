import { afterEach, describe, expect, it } from 'vitest'
import { devVersion, version } from '../src/version.ts'

const original = process.env.CLARA_VERSION

afterEach(() => {
  if (original === undefined) delete process.env.CLARA_VERSION
  else process.env.CLARA_VERSION = original
})

describe('command version', () => {
  it('identifies a checkout with its commit', () => {
    expect(devVersion('0.1.0', 'abc1234')).toBe('0.1.0-dev+abc1234')
    expect(devVersion('0.1.0', undefined)).toBe('0.1.0-dev')
  })

  it('prefers the build version', () => {
    process.env.CLARA_VERSION = '9.9.9'
    expect(version()).toBe('9.9.9')
  })

  it('tags a source checkout as a dev build', () => {
    delete process.env.CLARA_VERSION
    expect(version()).toMatch(/^0\.1\.0-dev(?:\+[0-9a-f]{7,})?$/)
  })
})
