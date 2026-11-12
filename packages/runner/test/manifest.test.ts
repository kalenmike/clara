import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { emptyManifest, readManifest, writeManifest } from '../src/manifest.ts'

test('round-trips a manifest with the shared runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-manifest-'))
  try {
    const path = join(dir, 'adapter.json')
    const manifest = {
      ...emptyManifest(),
      runner: {
        url: 'http://127.0.0.1:8789',
        workspace: '/tmp/work',
        concurrency: 2,
        labels: ['build'],
        service: 'systemd' as const,
        unitPath: '/tmp/clara-runner.service',
        explicit: false,
        installedAt: 2,
      },
    }
    writeManifest(path, manifest)
    expect(readManifest(path).runner).toEqual(manifest.runner)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns an empty manifest for a missing or invalid file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-manifest-'))
  try {
    expect(readManifest(join(dir, 'missing.json')).runner).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writes the runner manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-manifest-'))
  try {
    const path = join(dir, 'adapter.json')
    writeManifest(path, emptyManifest())
    expect(existsSync(path)).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
