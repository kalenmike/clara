import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import { HarnessStore } from '../src/harness/store.ts'
import { HarnessValidationError } from '../src/harness/types.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let store: HarnessStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clara-harness-'))
  db = openDatabase(join(dir, 'clara.db'))
  store = new HarnessStore({
    db,
    key: await loadSecretKey(generateSecretKey()),
    keyVersion: 1,
  })
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('harness store', () => {
  it('creates the first connection as active and encrypts its password', async () => {
    const connection = await store.save({
      kind: 'opencode',
      label: 'Local OpenCode',
      baseUrl: 'http://127.0.0.1:4096',
      authType: 'basic',
      password: 'secret-password',
    })

    expect(connection.isActive).toBe(true)
    expect(connection.secretConfigured).toBe(true)
    expect(store.active()?.id).toBe(connection.id)
    expect((await store.activeSecret())?.password).toBe('secret-password')

    const raw = db
      .prepare('SELECT ciphertext FROM harness_secrets WHERE connection_id = ?')
      .get(connection.id) as { ciphertext: Buffer }
    expect(raw.ciphertext.toString('utf8')).not.toContain('secret-password')
  })

  it('keeps an existing secret when a password is omitted on edit', async () => {
    const connection = await store.save({
      kind: 'opencode',
      label: 'OpenCode',
      baseUrl: 'http://opencode:4096',
      authType: 'basic',
      password: 'first-password',
    })

    const updated = await store.save(
      {
        kind: 'opencode',
        label: 'Renamed',
        baseUrl: 'http://opencode:4096',
        authType: 'basic',
      },
      connection.id
    )

    expect(updated.label).toBe('Renamed')
    expect(updated.secretConfigured).toBe(true)
    expect((await store.activeSecret())?.password).toBe('first-password')
  })

  it('keeps exactly one active connection', async () => {
    const first = await store.save({
      kind: 'opencode',
      label: 'First',
      baseUrl: 'http://first:4096',
      authType: 'none',
    })
    const second = await store.save({
      kind: 'opencode',
      label: 'Second',
      baseUrl: 'http://second:4096',
      authType: 'none',
    })

    expect(first.isActive).toBe(true)
    expect(second.isActive).toBe(false)
    store.setActive(second.id)
    expect(store.active()?.id).toBe(second.id)
    expect(store.list().filter((connection) => connection.isActive)).toHaveLength(1)
  })

  it('clears the active connection when it is removed', async () => {
    const connection = await store.save({
      kind: 'opencode',
      label: 'Only',
      baseUrl: 'http://opencode:4096',
      authType: 'none',
    })
    store.remove(connection.id)
    expect(store.active()).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('rejects unsafe URLs and unsupported harnesses', async () => {
    await expect(
      store.save({
        kind: 'opencode',
        label: 'Bad',
        baseUrl: 'file:///etc/passwd',
        authType: 'none',
      })
    ).rejects.toBeInstanceOf(HarnessValidationError)

    await expect(
      store.save({
        kind: 'opencode',
        label: 'Bad',
        baseUrl: 'http://user:pass@opencode:4096',
        authType: 'none',
      })
    ).rejects.toThrow(/credentials/)
  })
})
