import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test(
  'the shell installer reads the CLI artifacts, not the desktop block',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-install-manifest-'))
    try {
      const manifest = join(root, 'manifest.json')
      writeFileSync(
        manifest,
        JSON.stringify(
          {
            schemaVersion: 2,
            channel: 'stable',
            cli: {
              version: '0.2.0',
              artifacts: {
                'linux-x64': {
                  url: 'https://example.test/clara-linux-x64.tar.gz',
                  sha256: 'a'.repeat(64),
                  size: 10,
                },
              },
            },
            desktop: {
              version: '0.2.0',
              artifacts: {
                'linux-x64': {
                  url: 'https://example.test/Clara.AppImage',
                  sha256: 'b'.repeat(64),
                  size: 20,
                  type: 'appimage',
                },
              },
            },
          },
          null,
          2
        )
      )
      const script = `
      cli_manifest=$(awk '/^  "cli": \\{/ { inside = 1 } inside { print } inside && /^  \\}[,]?$/ { exit }' "$1")
      flat=$(printf '%s' "$cli_manifest" | tr -d '\\n')
      artifact=$(printf '%s' "$flat" | sed -n "s/.*\\"linux-x64\\"[[:space:]]*:[[:space:]]*{[^}]*\\"url\\"[[:space:]]*:[[:space:]]*\\"\\([^\\"]*\\)\\".*/\\1/p")
      sha=$(printf '%s' "$flat" | sed -n "s/.*\\"linux-x64\\"[[:space:]]*:[[:space:]]*{[^}]*\\"sha256\\"[[:space:]]*:[[:space:]]*\\"\\([^\\"]*\\)\\".*/\\1/p")
      printf '%s\\n%s\\n' "$artifact" "$sha"
    `
      const output = execFileSync('sh', ['-c', script, 'sh', manifest], { encoding: 'utf8' })
      assert.deepEqual(output.trim().split('\n'), [
        'https://example.test/clara-linux-x64.tar.gz',
        'a'.repeat(64),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)
