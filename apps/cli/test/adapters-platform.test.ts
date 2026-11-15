import { describe, expect, it } from 'vitest'
import {
  detectAdapterTarget,
  detectMusl,
  isAdapterTarget,
  targetFor,
  UnsupportedPlatformError,
} from '../src/adapters/platform.ts'

describe('adapter platform detection', () => {
  it('maps every supported operating system and architecture', () => {
    expect(targetFor('linux', 'x64')).toBe('linux-x64')
    expect(targetFor('linux', 'arm64')).toBe('linux-arm64')
    expect(targetFor('linux', 'x64', true)).toBe('linux-x64-musl')
    expect(targetFor('linux', 'arm64', true)).toBe('linux-arm64-musl')
    expect(targetFor('darwin', 'x64')).toBe('darwin-x64')
    expect(targetFor('darwin', 'arm64')).toBe('darwin-arm64')
    expect(targetFor('win32', 'x64')).toBe('win32-x64')
    expect(targetFor('win32', 'arm64')).toBe('win32-arm64')
  })

  it('rejects an architecture without a published build', () => {
    expect(targetFor('linux', 'ia32')).toBeUndefined()
    expect(targetFor('freebsd', 'x64')).toBeUndefined()
    expect(() => detectAdapterTarget({ platform: 'freebsd', arch: 'x64' })).toThrow(
      UnsupportedPlatformError
    )
  })

  it('uses the injected platform and musl flag', () => {
    expect(detectAdapterTarget({ platform: 'linux', arch: 'arm64', musl: true })).toBe(
      'linux-arm64-musl'
    )
    expect(detectAdapterTarget({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
  })

  it('detects musl from Alpine or ldd output', () => {
    expect(detectMusl({ exists: (path) => path === '/etc/alpine-release', ldd: () => '' })).toBe(
      true
    )
    expect(
      detectMusl({ exists: () => false, ldd: () => 'musl libc (x86_64)\nVersion 1.2.4' })
    ).toBe(true)
    expect(detectMusl({ exists: () => false, ldd: () => 'ldd (GNU libc) 2.39' })).toBe(false)
  })

  it('recognizes target names', () => {
    expect(isAdapterTarget('linux-x64-musl')).toBe(true)
    expect(isAdapterTarget('plan9-x64')).toBe(false)
  })
})
