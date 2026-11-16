import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type Progress = (received: number, total: number) => void

/**
 * Stream a release artifact to `dest` and verify its SHA-256 before returning.
 * The caller owns the destination and removes it on failure.
 */
export async function downloadVerified(options: {
  url: string
  sha256: string
  dest: string
  total?: number
  onProgress?: Progress
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(options.url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`)
  }
  mkdirSync(dirname(options.dest), { recursive: true, mode: 0o700 })

  const total = Number(response.headers.get('content-length')) || options.total || 0
  const hash = createHash('sha256')
  let received = 0
  const body = Readable.fromWeb(response.body as never)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.byteLength
    options.onProgress?.(received, total)
  })

  try {
    await pipeline(body, createWriteStream(options.dest, { mode: 0o600 }))
  } catch (cause) {
    rmSync(options.dest, { force: true })
    throw cause
  }
  const actual = hash.digest('hex')
  if (actual !== options.sha256.toLowerCase()) {
    rmSync(options.dest, { force: true })
    throw new Error(`The download checksum did not match (expected ${options.sha256}).`)
  }
}

export type ExtractResult = { command: string; args: string[]; status: number | null }
export type Runner = (command: string, args: string[]) => ExtractResult

/** Extract a release archive. tar.gz on POSIX, zip through PowerShell on Windows. */
export function extractArchive(
  archive: string,
  destination: string,
  platform: NodeJS.Platform = process.platform,
  run: Runner = defaultRunner
): ExtractResult {
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  if (platform === 'win32') {
    const command = 'powershell.exe'
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`,
    ]
    const result = run(command, args)
    if (result.status !== 0) throw new Error('The release archive could not be extracted.')
    return result
  }
  const command = process.platform === 'darwin' ? 'tar' : 'tar'
  const args = ['-xzf', archive, '-C', destination]
  const result = run(command, args)
  if (result.status !== 0) throw new Error('The release archive could not be extracted.')
  return result
}

function defaultRunner(command: string, args: string[]): ExtractResult {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return { command, args, status: result.status }
}
