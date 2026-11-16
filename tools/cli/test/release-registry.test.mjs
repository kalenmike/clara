import assert from 'node:assert/strict'
import test from 'node:test'
import { versionFromTag } from '../../lib/releases.mjs'
import { artifactProblems, desktopArtifactsFromAssets } from '../../release/lib.mjs'

function asset(name, sha = 'a'.repeat(64)) {
  return {
    name,
    size: 42,
    digest: `sha256:${sha}`,
    browser_download_url: `https://example.test/${name}`,
  }
}

test('maps the desktop release asset names to platform keys', () => {
  const assets = new Map(
    [
      asset('Clara_0.2.0_aarch64.dmg', '1'.repeat(64)),
      asset('Clara_0.2.0_x64.dmg', '2'.repeat(64)),
      asset('Clara_0.2.0_amd64.AppImage', '3'.repeat(64)),
      asset('Clara_0.2.0_x64-setup.exe', '4'.repeat(64)),
    ].map((entry) => [entry.name, entry])
  )
  const mapped = desktopArtifactsFromAssets(assets)
  assert.deepEqual(mapped.problems, [])
  assert.equal(mapped.artifacts['darwin-arm64'].type, 'dmg')
  assert.equal(mapped.artifacts['darwin-x64'].sha256, '2'.repeat(64))
  assert.equal(mapped.artifacts['linux-x64'].type, 'appimage')
  assert.equal(mapped.artifacts['win32-x64'].type, 'nsis')
})

test('reports missing required desktop builds', () => {
  const mapped = desktopArtifactsFromAssets(new Map())
  assert.ok(mapped.problems.includes('missing desktop asset for darwin-arm64'))
  assert.ok(mapped.problems.includes('missing desktop asset for linux-x64'))
})

test('validates artifact URLs and checksums', () => {
  assert.equal(
    artifactProblems('cli linux-x64', {
      url: 'http://example.test/a',
      sha256: 'nope',
      size: 0,
    }).length,
    3
  )
  assert.deepEqual(
    artifactProblems('cli linux-x64', {
      url: 'https://example.test/a',
      sha256: 'a'.repeat(64),
      size: 10,
    }),
    []
  )
})

test('recognises desktop tags', () => {
  assert.equal(versionFromTag('desktop-v0.2.0'), '0.2.0')
  assert.equal(versionFromTag('v0.2.0'), '0.2.0')
})
