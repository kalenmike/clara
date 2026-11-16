import { describe, expect, it } from 'vitest'
import { versionFromTag } from '../../tools/lib/releases.mjs'
import { artifactProblems, desktopArtifactsFromAssets } from '../../tools/release/lib.mjs'

function asset(name: string, sha = 'a'.repeat(64)) {
  return {
    name,
    size: 42,
    digest: `sha256:${sha}`,
    browser_download_url: `https://example.test/${name}`,
  }
}

describe('release registry artifacts', () => {
  it('maps the desktop release asset names to platform keys', () => {
    const assets = new Map(
      [
        asset('Clara_0.2.0_aarch64.dmg', '1'.repeat(64)),
        asset('Clara_0.2.0_x64.dmg', '2'.repeat(64)),
        asset('Clara_0.2.0_amd64.AppImage', '3'.repeat(64)),
        asset('Clara_0.2.0_x64-setup.exe', '4'.repeat(64)),
      ].map((entry) => [entry.name, entry])
    )
    const mapped = desktopArtifactsFromAssets(assets)
    expect(mapped.problems).toEqual([])
    expect(mapped.artifacts['darwin-arm64']).toMatchObject({ type: 'dmg', size: 42 })
    expect(mapped.artifacts['darwin-x64']?.sha256).toBe('2'.repeat(64))
    expect(mapped.artifacts['linux-x64']?.type).toBe('appimage')
    expect(mapped.artifacts['win32-x64']?.type).toBe('nsis')
  })

  it('reports missing required desktop builds', () => {
    const mapped = desktopArtifactsFromAssets(new Map())
    expect(mapped.problems).toContain('missing desktop asset for darwin-arm64')
    expect(mapped.problems).toContain('missing desktop asset for linux-x64')
  })

  it('validates artifact URLs and checksums', () => {
    expect(
      artifactProblems('cli linux-x64', {
        url: 'http://example.test/a',
        sha256: 'nope',
        size: 0,
      })
    ).toHaveLength(3)
    expect(
      artifactProblems('cli linux-x64', {
        url: 'https://example.test/a',
        sha256: 'a'.repeat(64),
        size: 10,
      })
    ).toEqual([])
  })

  it('recognises desktop tags', () => {
    expect(versionFromTag('desktop-v0.2.0')).toBe('0.2.0')
    expect(versionFromTag('v0.2.0')).toBe('0.2.0')
  })
})
