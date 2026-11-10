import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataDir, dbPath, tokenPath } from '../src/config.ts'

const KEYS = [
  'CLARA_DATA_DIR',
  'XDG_DATA_HOME',
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
    expect(tokenPath()).toBe(join(root, 'orchestrator.token'))
    expect(dbPath()).toBe(join(root, 'orchestration.db'))
  })

  it('honours an explicit local data directory', () => {
    reset()
    process.env.CLARA_DATA_DIR = '/srv/clara-local'
    expect(dataDir()).toBe('/srv/clara-local')
    expect(tokenPath()).toBe('/srv/clara-local/orchestrator.token')
    expect(dbPath()).toBe('/srv/clara-local/orchestration.db')
  })
})
