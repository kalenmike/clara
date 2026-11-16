import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  fetchLatestAdapterTag,
  isAdapterTag,
  versionFromTag,
} from '../../lib/releases.mjs'
import { ADAPTER_KINDS, SUPPORTED_TARGETS, checkRegistry } from '../../adapters/lib/registry.mjs'

const VERSION = '0.1.0-dev+abc1234'
const TAG = `adapters-v${VERSION}`

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function manifest(overrides = {}) {
  const install = `v${VERSION}-install.sh`
  const script = '#!/bin/sh\nexit 0\n'
  const artifacts = Object.fromEntries(
    SUPPORTED_TARGETS.map((target) => [
      target,
      {
        url: `https://github.com/example/clara/releases/download/${TAG}/clara-adapter-opencode-v${VERSION}-${target}.tar.gz`,
        sha256: 'b'.repeat(64),
        size: 1024,
      },
    ])
  )
  return {
    manifest: {
      schemaVersion: 1,
      harness: 'opencode',
      version: VERSION,
      install,
      installSha256: sha256(script),
      artifacts,
      ...overrides,
    },
    script,
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clara-registry-'))
  for (const kind of ADAPTER_KINDS) {
    const directory = join(root, kind)
    mkdirSync(directory, { recursive: true })
    const value = manifest({ harness: kind })
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(value.manifest))
    writeFileSync(join(directory, value.manifest.install), value.script)
  }
  return {
    root,
    write(kind, value) {
      const directory = join(root, kind)
      rmSync(directory, { recursive: true, force: true })
      mkdirSync(directory, { recursive: true })
      if (value === undefined) return
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify(value.manifest))
      writeFileSync(join(directory, value.manifest.install), value.script)
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('a complete registry passes the offline check', () => {
  const registry = fixture()
  try {
    const result = checkRegistry({ directory: registry.root })
    assert.deepEqual(result.problems, [])
    assert.deepEqual(
      result.summaries.map((entry) => entry.kind),
      [...ADAPTER_KINDS]
    )
    assert.equal(result.summaries[0].version, VERSION)
  } finally {
    registry.cleanup()
  }
})

test('reports a missing manifest and a stale version', () => {
  const registry = fixture()
  try {
    registry.write('claude', undefined)
    const missing = checkRegistry({ directory: registry.root, kinds: ['claude'] })
    assert.match(missing.problems.join('\n'), /claude: missing .*manifest\.json/)

    const stale = checkRegistry({
      directory: registry.root,
      kinds: ['opencode'],
      version: '0.2.0-dev+zzzzzzz',
    })
    assert.match(stale.problems.join('\n'), /publishes .* but the release is 0\.2\.0/)
  } finally {
    registry.cleanup()
  }
})

test('rejects a host-only build and an incomplete target set', () => {
  const registry = fixture()
  try {
    const value = manifest()
    value.manifest.artifacts['linux-x64'] = {
      url: './clara-adapter-opencode-linux-x64.tar.gz',
      sha256: 'c'.repeat(64),
      size: 1024,
    }
    delete value.manifest.artifacts['win32-arm64']
    registry.write('opencode', value)

    const result = checkRegistry({ directory: registry.root, kinds: ['opencode'] })
    const text = result.problems.join('\n')
    assert.match(text, /not absolute HTTPS/)
    assert.match(text, /no artifact for win32-arm64/)
    assert.equal(result.summaries.length, 0)
  } finally {
    registry.cleanup()
  }
})

test('rejects an install script whose hash does not match', () => {
  const registry = fixture()
  try {
    const value = manifest()
    registry.write('opencode', value)
    writeFileSync(join(registry.root, 'opencode', value.manifest.install), '#!/bin/sh\nexit 1\n')
    const result = checkRegistry({ directory: registry.root, kinds: ['opencode'] })
    assert.match(result.problems.join('\n'), /install script does not match installSha256/)
  } finally {
    registry.cleanup()
  }
})

test('compares every artifact with the release digest', () => {
  const registry = fixture()
  try {
    const assets = new Map(
      SUPPORTED_TARGETS.map((target) => [
        `clara-adapter-opencode-v${VERSION}-${target}.tar.gz`,
        { digest: `sha256:${'b'.repeat(64)}`, size: 1024 },
      ])
    )
    const good = checkRegistry({
      directory: registry.root,
      kinds: ['opencode'],
      version: VERSION,
      releaseAssets: assets,
    })
    assert.deepEqual(good.problems, [])

    const bad = checkRegistry({
      directory: registry.root,
      kinds: ['opencode'],
      version: VERSION,
      releaseAssets: new Map([
        [
          `clara-adapter-opencode-v${VERSION}-linux-x64.tar.gz`,
          { digest: `sha256:${'c'.repeat(64)}` },
        ],
      ]),
    })
    const text = bad.problems.join('\n')
    assert.match(text, /sha256 does not match the release asset/)
    assert.match(text, /is not an asset on the release/)
  } finally {
    registry.cleanup()
  }
})

test('resolves the newest published adapter tag and skips drafts', async () => {
  const fetchImpl = async (url) => {
    if (!url.includes('/releases?per_page=')) throw new Error(`unexpected ${url}`)
    return new Response(
      JSON.stringify([
        { tag_name: 'v0.4.0', draft: false },
        { tag_name: TAG, draft: true },
        { tag_name: 'adapters-v0.1.0-dev+older', draft: false },
      ]),
      { status: 200 }
    )
  }
  const tag = await fetchLatestAdapterTag({
    repo: 'example/clara',
    apiUrl: 'https://api.github.com',
    fetchImpl,
  })
  assert.equal(tag, 'adapters-v0.1.0-dev+older')
})

test('fails when no adapter release exists', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([]), { status: 200 })
  await assert.rejects(
    fetchLatestAdapterTag({
      repo: 'example/clara',
      apiUrl: 'https://api.github.com',
      fetchImpl,
    }),
    /No published adapters-v\* release/
  )
})

test('recognises adapter tags and their versions', () => {
  assert.equal(versionFromTag(TAG), VERSION)
  assert.equal(versionFromTag('v1.2.3'), '1.2.3')
  assert.equal(versionFromTag('not-a-tag'), undefined)
  assert.equal(isAdapterTag(TAG), true)
  assert.equal(isAdapterTag('adapters-v'), false)
  assert.equal(isAdapterTag('v0.1.0'), false)
})
