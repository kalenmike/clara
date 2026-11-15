import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadVerified, extractArchive } from '../src/release/download.ts'
import { platformKey } from '../src/release/platform.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-download-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const payload = Buffer.from('clara release payload')
const sha = createHash('sha256').update(payload).digest('hex')

function fetchWith(body: Buffer): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-length': String(body.byteLength) },
    })) as unknown as typeof fetch
}

describe('download', () => {
  it('streams an artifact and verifies its checksum', async () => {
    const dest = join(dir, 'clara.tar.gz')
    const progress: number[] = []
    await downloadVerified({
      url: 'https://example.test/clara.tar.gz',
      sha256: sha,
      dest,
      fetchImpl: fetchWith(payload),
      onProgress: (received) => progress.push(received),
    })
    expect(readFileSync(dest)).toEqual(payload)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('removes a download whose checksum does not match', async () => {
    const dest = join(dir, 'clara.tar.gz')
    await expect(
      downloadVerified({
        url: 'https://example.test/clara.tar.gz',
        sha256: 'b'.repeat(64),
        dest,
        fetchImpl: fetchWith(payload),
      })
    ).rejects.toThrow(/checksum/)
    expect(() => readFileSync(dest)).toThrow()
  })

  it('fails when the server rejects the download', async () => {
    const failing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    await expect(
      downloadVerified({
        url: 'https://example.test/nope',
        sha256: sha,
        dest: join(dir, 'nope'),
        fetchImpl: failing,
      })
    ).rejects.toThrow(/HTTP 404/)
  })
})

describe('extraction', () => {
  it('uses tar for POSIX archives', () => {
    const calls: string[][] = []
    extractArchive('/tmp/clara.tar.gz', '/tmp/out', 'linux', (command, args) => {
      calls.push([command, ...args])
      return { command, args, status: 0 }
    })
    expect(calls[0]).toEqual(['tar', '-xzf', '/tmp/clara.tar.gz', '-C', '/tmp/out'])
  })

  it('uses PowerShell for Windows archives', () => {
    const calls: string[][] = []
    extractArchive('C:\\clara.zip', 'C:\\out', 'win32', (command, args) => {
      calls.push([command, ...args])
      return { command, args, status: 0 }
    })
    expect(calls[0]?.[0]).toBe('powershell.exe')
    expect(calls[0]?.join(' ')).toContain('Expand-Archive')
  })
})

describe('platform keys', () => {
  it('detects the release platform', () => {
    expect(platformKey({ platform: 'linux', arch: 'x64', isMusl: () => false })).toBe('linux-x64')
    expect(platformKey({ platform: 'linux', arch: 'arm64', isMusl: () => true })).toBe(
      'linux-arm64-musl'
    )
    expect(platformKey({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
    expect(platformKey({ platform: 'win32', arch: 'x64' })).toBe('win32-x64')
  })
})
