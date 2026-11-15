import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataDir, dbPath, tokenPath } from '../src/config.ts'

const KEYS = [
  'CLARA_DATA_DIR',
  'XDG_DATA_HOME',
  'CLARA_ENGINE_TOKEN_FILE',
  'CLARA_ENGINE_DB_PATH',
  'CLARA_ORCHESTRATION_TOKEN_FILE',
  'CLARA_ORCHESTRATION_DB_PATH',
]

const previous: Record<string, string | undefined> = {}
for (const key of KEYS) previous[key] = process.env[key]

function reset(): void {
  for (const key of KEYS) delete process.env[key]
}

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('local data paths', () => {
  it('keeps the standalone defaults outside Docker state', () => {
    reset()
    const root = join(homedir(), '.local', 'share', 'clara')
    expect(dataDir()).toBe(root)
    expect(tokenPath()).toBe(join(root, 'engine.token'))
    expect(dbPath()).toBe(join(root, 'engine.db'))
  })

  it('honours an explicit local data directory', () => {
    reset()
    process.env.CLARA_DATA_DIR = '/srv/clara-local'
    expect(dataDir()).toBe('/srv/clara-local')
    expect(tokenPath()).toBe('/srv/clara-local/engine.token')
    expect(dbPath()).toBe('/srv/clara-local/engine.db')
  })

  it('reads the historical environment names for one release', () => {
    reset()
    process.env.CLARA_ORCHESTRATION_TOKEN_FILE = '/srv/legacy.token'
    process.env.CLARA_ORCHESTRATION_DB_PATH = '/srv/legacy.db'
    expect(tokenPath()).toBe('/srv/legacy.token')
    expect(dbPath()).toBe('/srv/legacy.db')
  })

  it('moves the historical database to its new name', () => {
    reset()
    const root = mkdtempSync(join(tmpdir(), 'clara-engine-paths-'))
    try {
      process.env.CLARA_DATA_DIR = root
      writeFileSync(join(root, 'orchestration.db'), 'legacy')
      expect(dbPath()).toBe(join(root, 'engine.db'))
      expect(existsSync(join(root, 'engine.db'))).toBe(true)
      expect(existsSync(join(root, 'orchestration.db'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
