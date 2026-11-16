import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ClaraPaths } from './paths.ts'

export type InstallInfo = {
  schemaVersion: 1
  version: string
  channel: string
  installedAt: string
  source: string
  previous?: string
}

/** Compare two release versions. A release outranks its prerelease. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index]! - b.numbers[index]!
  }
  if (!a.prerelease && !b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumber = /^\d+$/.test(one)
    const twoNumber = /^\d+$/.test(two)
    if (oneNumber && twoNumber) {
      const difference = Number(one) - Number(two)
      if (difference !== 0) return difference
    } else if (oneNumber) return -1
    else if (twoNumber) return 1
    else if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

export function installsDir(paths: ClaraPaths): string {
  return join(paths.dataDir, 'versions')
}

export function versionBinary(paths: ClaraPaths, version: string): string {
  return join(installsDir(paths), version, process.platform === 'win32' ? 'clara.exe' : 'clara')
}

export function installInfoPath(paths: ClaraPaths): string {
  return join(paths.configDir, 'install.json')
}

export function readInstallInfo(paths: ClaraPaths): InstallInfo | undefined {
  try {
    const path = installInfoPath(paths)
    if (!existsSync(path)) return undefined
    const value = JSON.parse(readFileSync(path, 'utf8')) as InstallInfo
    return value?.schemaVersion === 1 && typeof value.version === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export function writeInstallInfo(paths: ClaraPaths, info: InstallInfo): void {
  const path = installInfoPath(paths)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

/** Write a downloaded binary into its version slot and make it executable. */
export function stageBinary(paths: ClaraPaths, version: string, bytes: Buffer): string {
  const target = versionBinary(paths, version)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, bytes, { mode: 0o755 })
  if (process.platform !== 'win32') chmodSync(temp, 0o755)
  renameSync(temp, target)
  return target
}

/** Point the install directory at one version. POSIX uses a symlink. */
export function activateVersion(
  paths: ClaraPaths,
  version: string,
  binDir = defaultBinDir()
): string {
  const source = versionBinary(paths, version)
  if (!existsSync(source)) throw new Error(`Version ${version} is not installed.`)
  mkdirSync(binDir, { recursive: true, mode: 0o755 })
  const target = join(binDir, process.platform === 'win32' ? 'clara.exe' : 'clara')

  if (process.platform === 'win32') {
    const temp = `${target}.${process.pid}.tmp`
    copyFileSync(source, temp)
    renameSync(temp, target)
    return target
  }

  const temp = `${target}.${process.pid}.tmp`
  rmSync(temp, { force: true })
  symlinkSync(source, temp)
  renameSync(temp, target)
  return target
}

/** Remove every version except the current one and its predecessor. */
export function pruneVersions(paths: ClaraPaths, keep: readonly string[]): void {
  const root = installsDir(paths)
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    if (!keep.includes(entry)) rmSync(join(root, entry), { recursive: true, force: true })
  }
}

export function defaultBinDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_BIN_DIR?.trim()
  if (configured) return configured
  if (process.platform === 'win32') {
    const base = env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
    return join(base, 'Clara', 'bin')
  }
  return join(homedir(), '.local', 'bin')
}

/** The Windows launcher marker lets an uninstall remove only files Clara wrote. */
const WINDOWS_LAUNCHER_MARKER = 'rem Clara command launcher'

/** The path a named command is linked to inside the user's binary directory. */
export function binaryLinkPath(name: string, binDir = defaultBinDir()): string {
  return join(binDir, process.platform === 'win32' ? `${name}.cmd` : name)
}

/**
 * Point a user command at an installed binary. POSIX uses an atomic symlink;
 * Windows writes a small `.cmd` shim so a native binary is never copied or
 * shadowed. A file Clara did not create is left alone instead of overwritten.
 */
export function linkBinary(input: { source: string; name: string; binDir?: string }): {
  path: string
  target: string
} {
  const binDir = input.binDir ?? defaultBinDir()
  mkdirSync(binDir, { recursive: true, mode: 0o755 })
  const target = binaryLinkPath(input.name, binDir)

  if (process.platform === 'win32') {
    if (existsSync(target) && !isWindowsLauncher(target, input.source)) {
      throw new Error(`Refusing to replace ${target}; it was not written by Clara.`)
    }
    writeFileSync(target, `@echo off\r\n${WINDOWS_LAUNCHER_MARKER}\r\n"${input.source}" %*\r\n`, {
      mode: 0o755,
    })
    return { path: target, target: input.source }
  }

  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace ${target}; it is not a Clara symlink.`)
    }
  } else {
    try {
      if (!lstatSync(target).isSymbolicLink()) {
        throw new Error(`Refusing to replace ${target}; it is not a Clara symlink.`)
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
  const temporary = `${target}.${process.pid}.tmp`
  rmSync(temporary, { force: true })
  symlinkSync(input.source, temporary)
  renameSync(temporary, target)
  return { path: target, target: input.source }
}

/**
 * Remove a command link only when it still points at the expected binary (or,
 * on Windows, carries the Clara marker). Returns whether a file was removed.
 */
export function removeBinaryLink(input: {
  name: string
  source?: string
  binDir?: string
}): boolean {
  const target = binaryLinkPath(input.name, input.binDir)
  if (!existsSync(target)) return false
  if (process.platform === 'win32') {
    if (!isWindowsLauncher(target, input.source)) return false
    rmSync(target, { force: true })
    return true
  }
  const stat = lstatSync(target)
  if (!stat.isSymbolicLink()) return false
  if (input.source) {
    try {
      if (resolve(readlinkSync(target)) !== resolve(input.source)) return false
    } catch {
      return false
    }
  }
  rmSync(target, { force: true })
  return true
}

function isWindowsLauncher(path: string, source?: string): boolean {
  try {
    const text = readFileSync(path, 'utf8')
    if (!text.includes(WINDOWS_LAUNCHER_MARKER)) return false
    return source ? text.includes(source) : true
  } catch {
    return false
  }
}

function parseVersion(value: string): { numbers: number[]; prerelease?: string[] } {
  const [core, ...rest] = value.split('-')
  const numbers = (core ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const prerelease = rest.join('-')
  return { numbers, ...(prerelease ? { prerelease: prerelease.split('.') } : {}) }
}
