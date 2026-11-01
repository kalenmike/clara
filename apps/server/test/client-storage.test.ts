import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ClientStorageStore,
  isSecretSyncKey,
  MAX_SYNC_LIVE_ENTRIES,
  MAX_SYNC_NAMESPACE_BYTES,
  normalizeNamespace,
} from '../src/store/client-storage.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

const tempDirs: string[] = []
const databases: ClaraDatabase[] = []

function openStore(): ClientStorageStore {
  const dir = mkdtempSync(join(tmpdir(), 'clara-client-storage-'))
  tempDirs.push(dir)
  const db = openDatabase(join(dir, 'clara.db'))
  databases.push(db)
  return new ClientStorageStore(db)
}

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ClientStorageStore', () => {
  it('defaults the namespace and isolates namespaces', () => {
    const store = openStore()
    expect(store.pull(undefined)).toMatchObject({
      ok: true,
      snapshot: { namespace: 'default', revision: 0, entries: [] },
    })
    expect(
      store.push({
        type: 'sync.push',
        id: 'x',
        namespace: 'work',
        entries: [{ key: 'clara.theme', value: 'nord' }],
      })
    ).toMatchObject({ ok: true })

    const work = store.pull('work')
    expect(work).toMatchObject({
      ok: true,
      snapshot: { namespace: 'work', revision: 1 },
    })
    if (!work.ok) throw new Error('Expected a snapshot')
    expect(work.snapshot.entries).toHaveLength(1)

    const fallback = store.pull('default')
    if (!fallback.ok) throw new Error('Expected a snapshot')
    expect(fallback.snapshot.entries).toEqual([])
  })

  it('validates namespaces, keys, duplicates, and secret names', () => {
    const store = openStore()
    expect(normalizeNamespace(undefined)).toEqual({ ok: true, value: 'default' })
    expect(normalizeNamespace('team-1_a')).toEqual({ ok: true, value: 'team-1_a' })
    expect(normalizeNamespace('Upper').ok).toBe(false)
    expect(store.pull('Upper')).toMatchObject({ ok: false, code: 'invalid' })
    expect(store.pull('bad space')).toMatchObject({ ok: false, code: 'invalid' })

    expect(
      store.push({
        type: 'sync.push',
        id: 'key',
        entries: [{ key: 'bad\nkey', value: 'x' }],
      })
    ).toMatchObject({ ok: false, code: 'invalid' })

    expect(
      store.push({
        type: 'sync.push',
        id: 'duplicate',
        entries: [
          { key: 'clara.theme', value: 'a' },
          { key: 'clara.theme', value: 'b' },
        ],
      })
    ).toMatchObject({ ok: false, code: 'invalid' })

    for (const key of [
      'clara.connection.local',
      'Clara.Connection.Session',
      'my.psk.value',
      'user.password',
      'clara.oauth-token',
      'private-key',
      'pairing-code',
      'authorization',
    ]) {
      expect(isSecretSyncKey(key)).toBe(true)
    }
    for (const key of ['clara.theme', 'clara.sidebarWidth', 'clara.notifications']) {
      expect(isSecretSyncKey(key)).toBe(false)
    }
  })

  it('rejects more than the live-entry or byte limit in a namespace', () => {
    const store = openStore()
    for (let batch = 0; batch < MAX_SYNC_LIVE_ENTRIES / 100; batch += 1) {
      const entries = Array.from({ length: 100 }, (_, index) => ({
        key: `entry-${batch * 100 + index}`,
        value: 'v',
      }))
      expect(store.push({ type: 'sync.push', id: `batch-${batch}`, entries })).toMatchObject({
        ok: true,
      })
    }

    expect(
      store.push({
        type: 'sync.push',
        id: 'over-count',
        entries: [{ key: 'one-too-many', value: 'v' }],
      })
    ).toMatchObject({ ok: false, code: 'too_large' })

    const large = openStore()
    const entries = Array.from({ length: 50 }, (_, index) => ({
      key: `large-${index}`,
      value: 'x'.repeat(Math.ceil(MAX_SYNC_NAMESPACE_BYTES / 40)),
    }))
    expect(large.push({ type: 'sync.push', id: 'too-big', entries })).toMatchObject({
      ok: false,
      code: 'too_large',
    })
  })

  it('reports counts and bytes without exposing values', () => {
    const store = openStore()
    store.push({
      type: 'sync.push',
      id: 'stats',
      namespace: 'stats',
      entries: [
        { key: 'one', value: 'abc' },
        { key: 'two', value: 'de' },
      ],
    })
    store.push({
      type: 'sync.push',
      id: 'stats-delete',
      namespace: 'stats',
      baseRevision: 1,
      entries: [{ key: 'two', value: null }],
    })

    expect(store.stats()).toEqual({
      namespaces: 1,
      entries: 2,
      liveEntries: 1,
      tombstones: 1,
      bytes: 3,
    })
  })
})
