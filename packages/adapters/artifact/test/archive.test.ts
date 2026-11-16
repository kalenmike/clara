import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  archiveFormat,
  assertContained,
  assertSafeArchiveMembers,
  extractArchive,
  type CommandResult,
  type CommandRunner,
} from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-archive-'))
  roots.push(root)
  return root
}

function runner(
  calls: Array<{ command: string; args: string[] }>,
  listing = './clara-adapter-opencode\n./plugin/index.js\n'
): CommandRunner {
  return (command, args): CommandResult => {
    calls.push({ command, args: [...args] })
    if (args.includes('-tzf')) return { status: 0, stdout: listing, stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adapter archives', () => {
  it('detects the artifact format from its URL', () => {
    expect(archiveFormat('https://example.test/a/adapter.tar.gz')).toBe('tar.gz')
    expect(archiveFormat('https://example.test/a/adapter.zip?token=1')).toBe('zip')
  })

  it('lists and extracts a safe tar archive', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const dest = tempDir()
    extractArchive({
      archive: '/tmp/adapter.tar.gz',
      dest,
      format: 'tar.gz',
      run: runner(calls),
    })
    expect(calls.map((call) => [call.command, call.args[0]])).toEqual([
      ['tar', '-tzf'],
      ['tar', '-xzf'],
    ])
  })

  it('falls back to bsdtar when tar is missing', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const dest = tempDir()
    const fallback: CommandRunner = (command, args) => {
      calls.push({ command, args: [...args] })
      if (command === 'tar') return { status: null, stdout: '', stderr: '', code: 'ENOENT' }
      return { status: 0, stdout: './clara-adapter-claude\n', stderr: '' }
    }
    extractArchive({
      archive: '/tmp/adapter.tar.gz',
      dest,
      format: 'tar.gz',
      run: fallback,
    })
    expect(calls.map((call) => call.command)).toEqual(['tar', 'bsdtar', 'bsdtar'])
  })

  it('rejects members that escape the destination', () => {
    expect(() => assertSafeArchiveMembers(['./ok', '../evil'])).toThrow('escapes')
    expect(() => assertSafeArchiveMembers(['/absolute'])).toThrow('absolute')
    expect(() => assertSafeArchiveMembers(['C:\\absolute'])).toThrow('absolute')
    expect(() => assertSafeArchiveMembers(['./a/../../b'])).toThrow('escapes')
    expect(() => assertSafeArchiveMembers(['./a', './b.txt'])).not.toThrow()
  })

  it('rejects a traversal member before extracting', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const dest = tempDir()
    expect(() =>
      extractArchive({
        archive: '/tmp/adapter.tar.gz',
        dest,
        format: 'tar.gz',
        run: runner(calls, '../escape\n'),
      })
    ).toThrow('escapes')
    expect(calls.map((call) => call.args[0])).toEqual(['-tzf'])
  })

  it('rejects symlinks that point outside the tree', () => {
    const root = tempDir()
    const outside = tempDir()
    mkdirSync(join(root, 'nested'))
    symlinkSync(outside, join(root, 'nested', 'link'))
    expect(() => assertContained(root)).toThrow('links outside')
  })

  it('extracts a zip through PowerShell', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const dest = tempDir()
    const zip: CommandRunner = (command, args) => {
      calls.push({ command, args: [...args] })
      return { status: 0, stdout: '', stderr: '' }
    }
    extractArchive({
      archive: '/tmp/adapter.zip',
      dest,
      format: 'zip',
      run: zip,
    })
    expect(calls[0]?.command).toBe('powershell')
    expect(calls[0]?.args.at(-1)).toContain('Expand-Archive')
    expect(calls[0]?.args.at(-1)).toContain(dest)
  })

  it('falls back to pwsh when powershell is not installed', () => {
    const calls: string[] = []
    const dest = tempDir()
    extractArchive({
      archive: '/tmp/adapter.zip',
      dest,
      format: 'zip',
      run: (command) => {
        calls.push(command)
        return command === 'powershell'
          ? { status: null, stdout: '', stderr: '', code: 'ENOENT' }
          : { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(calls).toEqual(['powershell', 'pwsh'])
  })
})
