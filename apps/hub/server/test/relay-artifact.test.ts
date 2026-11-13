import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRelayArtifact } from '../src/features/cloudflare-deployment/artifact.ts'

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.CLARA_RELAY_ARTIFACT_DIR
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('relay deployment artifact', () => {
  it('matches the Wrangler configuration it replaces', () => {
    const config = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'infra', 'relay', 'wrangler.jsonc'),
      'utf8'
    )
    expect(config).toContain('"name": "clara-relay"')
    expect(config).toContain('"compatibility_date": "2026-10-30"')
    expect(config).toContain('"name": "RELAY_ROOMS"')
    expect(config).toContain('"class_name": "RelayRoom"')
    expect(config).toContain('"new_sqlite_classes": ["RelayRoom"]')
  })

  it('reads the generated worker and manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-relay-artifact-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'worker.mjs'), 'export default {}')
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        scriptName: 'clara-relay',
        mainModule: 'clara-relay.mjs',
        compatibilityDate: '2026-10-30',
        migrationTag: 'v1',
        durableObject: { binding: 'RELAY_ROOMS', className: 'RelayRoom' },
      })
    )
    process.env.CLARA_RELAY_ARTIFACT_DIR = dir

    const artifact = loadRelayArtifact()
    expect(artifact.code).toBe('export default {}')
    expect(artifact.durableObject).toEqual({ binding: 'RELAY_ROOMS', className: 'RelayRoom' })
  })
})
