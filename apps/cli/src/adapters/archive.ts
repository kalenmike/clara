import { spawnSync } from 'node:child_process'
import { readdirSync, readlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type ArchiveFormat = 'tar.gz' | 'zip'

export type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
  code?: string
  error?: string
}

export type CommandRunner = (command: string, args: readonly string[]) => CommandResult

export type ExtractOptions = {
  archive: string
  dest: string
  format: ArchiveFormat
  /** Injected in tests; defaults to a synchronous child process. */
  run?: CommandRunner
}

/** Adapter releases are tar.gz; a zip is accepted for Windows mirrors. */
export function archiveFormat(url: string): ArchiveFormat {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  return path.endsWith('.zip') ? 'zip' : 'tar.gz'
}

/** Extract an archive after checking that its members cannot escape `dest`. */
export function extractArchive(options: ExtractOptions): void {
  const run = options.run ?? spawnRun
  if (options.format === 'zip') extractZip(options.archive, options.dest, run)
  else extractTar(options.archive, options.dest, run)
  assertContained(options.dest)
}

export function assertSafeArchiveMembers(members: readonly string[]): void {
  for (const member of members) {
    const name = member.trim().replace(/^\.\//, '')
    if (!name) continue
    if (name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name)) {
      throw new Error(`The adapter archive has an absolute path: ${member}`)
    }
    if (name.split(/[\\/]/).includes('..')) {
      throw new Error(`The adapter archive escapes its directory: ${member}`)
    }
  }
}

/** Reject symlinks that point outside the extracted tree. */
export function assertContained(root: string): void {
  const base = resolve(root)
  walk(base, base)
}

/** A synchronous child-process runner that captures stdout and stderr. */
export function spawnRun(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  const failure = result.error as NodeJS.ErrnoException | undefined
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(failure?.code ? { code: failure.code } : {}),
    ...(failure?.message ? { error: failure.message } : {}),
  }
}

function extractTar(archive: string, dest: string, run: CommandRunner): void {
  const first = run('tar', ['-tzf', archive])
  let tool = 'tar'
  let listing = first
  if (first.code === 'ENOENT') {
    tool = 'bsdtar'
    listing = run('bsdtar', ['-tzf', archive])
  }
  assertSuccess(listing, `${tool} could not list the adapter archive`)
  assertSafeArchiveMembers(listing.stdout.split('\n'))

  const extracted = run(tool, ['-xzf', archive, '-C', dest])
  assertSuccess(extracted, `${tool} could not extract the adapter archive`)
}

function extractZip(archive: string, dest: string, run: CommandRunner): void {
  const script =
    `Expand-Archive -LiteralPath '${quotePowerShell(archive)}' ` +
    `-DestinationPath '${quotePowerShell(dest)}' -Force`
  const result = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  assertSuccess(result, 'PowerShell could not extract the adapter archive')
}

function assertSuccess(result: CommandResult, label: string): void {
  if (result.status === 0) return
  const detail = result.stderr.trim() || result.error || `exit ${String(result.status)}`
  throw new Error(`${label}: ${detail}`)
}

function quotePowerShell(value: string): string {
  return value.replaceAll("'", "''")
}

function walk(root: string, directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path))
      if (!contains(root, target)) {
        throw new Error(`The adapter archive links outside its directory: ${relative(root, path)}`)
      }
      continue
    }
    if (entry.isDirectory()) walk(root, path)
  }
}

function contains(root: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}
