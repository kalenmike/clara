import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  closeDatabase,
  DEFAULT_SETTINGS,
  openDatabase,
  schemaVersion,
  SCHEMA_VERSION,
} from '../src/store/database.ts'
import { FEATURE_NAMES, SettingsStore } from '../src/store/settings.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SQLite settings store', () => {
  it('creates an empty database with every default setting', () => {
    const path = join(tempDir(), 'clara.db')
    const db = openDatabase(path)
    try {
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION)
      const settings = new SettingsStore(db)
      expect(settings.get()).toEqual({
        features: { opencode: true, local: true, relay: true, push: true },
        stopped: false,
      })
      const rows = db.prepare('SELECT key FROM settings ORDER BY key').all() as Array<{
        key: string
      }>
      expect(rows.map((row) => row.key)).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    } finally {
      closeDatabase(db)
    }
  })

  it('reopens the database and reads persisted values', () => {
    const path = join(tempDir(), 'clara.db')
    const first = openDatabase(path)
    const settings = new SettingsStore(first)
    settings.setFeature('relay', false)
    settings.setFeature('push', false)
    settings.setStopped(true)
    closeDatabase(first)

    const second = openDatabase(path)
    try {
      expect(schemaVersion(second)).toBe(SCHEMA_VERSION)
      expect(new SettingsStore(second).get()).toEqual({
        features: {
          opencode: true,
          local: true,
          relay: false,
          push: false,
        },
        stopped: true,
      })
    } finally {
      closeDatabase(second)
    }
  })

  it('rejects invalid and missing stored values instead of using defaults', () => {
    const path = join(tempDir(), 'clara.db')
    const db = openDatabase(path)
    try {
      const settings = new SettingsStore(db)
      db.prepare("UPDATE settings SET value = '1' WHERE key = ?").run('features.local')
      expect(() => settings.get()).toThrow(/features\.local.*boolean/)

      db.prepare("UPDATE settings SET value = 'not json' WHERE key = ?").run('features.local')
      expect(() => settings.get()).toThrow(/features\.local.*valid JSON/)

      db.prepare('DELETE FROM settings WHERE key = ?').run('features.local')
      expect(() => settings.get()).toThrow(/features\.local.*missing/)
    } finally {
      closeDatabase(db)
    }
  })

  it('rejects unknown setting values before writing', () => {
    const path = join(tempDir(), 'clara.db')
    const db = openDatabase(path)
    try {
      const settings = new SettingsStore(db)
      expect(() => settings.setFeature('unknown' as never, true)).toThrow(/Unknown Clara feature/)
      expect(() => settings.setStopped('yes' as never)).toThrow(/must be a boolean/)
      expect(FEATURE_NAMES).toEqual(['opencode', 'local', 'relay', 'push'])
    } finally {
      closeDatabase(db)
    }
  })

  it('creates the database with private file permissions', () => {
    const dir = tempDir()
    const path = join(dir, 'nested', 'clara.db')
    const db = openDatabase(path)
    try {
      if (process.platform === 'win32') return
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700)
      for (const suffix of ['-wal', '-shm']) {
        try {
          expect(statSync(`${path}${suffix}`).mode & 0o777).toBe(0o600)
        } catch {
          // SQLite may not have created the sidecar yet.
        }
      }
    } finally {
      closeDatabase(db)
    }
  })

  it('fails startup with the path when the schema version is unsupported', () => {
    const path = join(tempDir(), 'clara.db')
    const db = openDatabase(path)
    db.pragma('user_version = 99')
    closeDatabase(db)

    expect(() => openDatabase(path)).toThrow(path)
    expect(() => openDatabase(path)).toThrow(/not supported/)
  })
})
