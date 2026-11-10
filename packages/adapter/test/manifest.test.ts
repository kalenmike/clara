import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  emptyManifest,
  readManifest,
  writeManifest,
  type InstallManifest,
} from '../src/manifest.ts'

test('round-trips a manifest with a harness and a runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-manifest-'))
  try {
    const path = join(dir, 'adapter.json')
    const manifest: InstallManifest = {
      ...emptyManifest(),
      harnesses: {
        opencode: {
          pluginPath: '/tmp/plugin',
          agentPath: '/tmp/agent',
          configPath: '/tmp/config',
          mcp: true,
          installedAt: 1,
        },
      },
      runner: {
        url: 'http://127.0.0.1:8789',
        workspace: '/tmp/work',
        concurrency: 2,
        labels: ['build'],
        service: 'systemd',
        unitPath: '/tmp/clara-runner.service',
        explicit: false,
        installedAt: 2,
      },
    }
    writeManifest(path, manifest)
    const read = readManifest(path)
    assert.deepEqual(read.harnesses.opencode, manifest.harnesses.opencode)
    assert.deepEqual(read.runner, manifest.runner)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns an empty manifest for a missing or invalid file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-manifest-'))
  try {
    assert.deepEqual(readManifest(join(dir, 'missing.json')).harnesses, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
