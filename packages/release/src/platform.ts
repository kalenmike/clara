import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export type ReleasePlatform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'linux-x64-musl'
  | 'linux-arm64-musl'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'
  | 'win32-arm64'

export type PlatformInput = {
  platform?: NodeJS.Platform
  arch?: string
  isMusl?: () => boolean
}

export function platformKey(input: PlatformInput = {}): ReleasePlatform | undefined {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const arm = arch === 'arm64' ? 'arm64' : 'x64'

  if (platform === 'linux') {
    const musl = (input.isMusl ?? detectMusl)()
    return `linux-${arm}${musl ? '-musl' : ''}` as ReleasePlatform
  }
  if (platform === 'darwin') return `darwin-${arm}` as ReleasePlatform
  if (platform === 'win32') return `win32-${arm}` as ReleasePlatform
  return undefined
}

export function detectMusl(): boolean {
  if (existsSync('/etc/alpine-release')) return true
  try {
    const ldd = spawnSync('ldd', ['--version'], { encoding: 'utf8', timeout: 2_000 })
    return /musl/i.test(`${ldd.stdout ?? ''}${ldd.stderr ?? ''}`)
  } catch {
    return false
  }
}
