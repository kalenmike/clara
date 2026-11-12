import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKey, generateSecretKey, loadSecretKey } from '@clara/crypto'
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

async function enroll(input: {
  harnessId?: string
  adapterId?: string
  key?: string
  kind?: string
  label?: string
}) {
  const pairing = await store.createPairing({
    kind: input.kind ?? 'opencode',
    label: input.label ?? 'OpenCode',
  })
  return store.enroll({
    pairId: pairing.id,
    pairToken: pairing.token,
    harnessId: input.harnessId ?? 'harness-a',
    kind: input.kind ?? 'opencode',
    label: input.label ?? 'OpenCode',
    adapterId: input.adapterId ?? 'adapter-a',
    key: input.key ?? generateKey(),
    adapterVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: { sessions: true },
    transport: 'local',
  })
}

describe('harness store', () => {
  it('creates the first adapter connection as active and stores its credential', async () => {
    const key = generateKey()
    const result = await enroll({ key })
    expect(result.connection.isActive).toBe(true)
    expect(result.connection.credentialConfigured).toBe(true)
    expect(store.active()?.id).toBe(result.connection.id)
    expect((await store.credential('adapter-a'))?.key).toBe(key)

    const raw = db
      .prepare('SELECT key_ciphertext FROM adapter_credentials WHERE adapter_id = ?')
      .get('adapter-a') as { key_ciphertext: Buffer }
    expect(raw.key_ciphertext.toString('utf8')).not.toContain(key)
  })

  it('keeps the pairing token retryable but never marks enrollment online', async () => {
    const pairing = await store.createPairing({ kind: 'opencode', label: 'OpenCode' })
    expect(await store.pairingToken(pairing.id)).toBe(pairing.token)
    const key = generateKey()

    const result = await store.enroll({
      pairId: pairing.id,
      pairToken: pairing.token,
      harnessId: 'harness-a',
      kind: 'opencode',
      label: 'OpenCode',
      adapterId: 'adapter-a',
      key,
      adapterVersion: '0.1.0',
      protocolVersion: 1,
      capabilities: {},
      transport: 'local',
    })
    expect(result.connection.online).toBe(false)
    expect(await store.pairingToken(pairing.id)).toBe(pairing.token)

    const retry = await store.enroll({
      pairId: pairing.id,
      pairToken: pairing.token,
      harnessId: 'harness-a',
      kind: 'opencode',
      label: 'OpenCode',
      adapterId: 'adapter-a',
      key,
      adapterVersion: '0.1.0',
      protocolVersion: 1,
      capabilities: {},
      transport: 'local',
    })
    expect(retry.reconnected).toBe(true)
    expect(retry.connection.id).toBe(result.connection.id)

    await expect(
      store.enroll({
        pairId: pairing.id,
        pairToken: pairing.token,
        harnessId: 'harness-b',
        kind: 'opencode',
        label: 'OpenCode',
        adapterId: 'adapter-b',
        key: generateKey(),
        adapterVersion: '0.1.0',
        protocolVersion: 1,
        capabilities: {},
        transport: 'local',
      })
    ).rejects.toBeInstanceOf(HarnessValidationError)
  })

  it('reuses the same connection when the stable identity pairs again', async () => {
    const first = await enroll({ harnessId: 'same', adapterId: 'one' })
    const second = await enroll({ harnessId: 'same', adapterId: 'two' })
    expect(second.reconnected).toBe(true)
    expect(second.connection.id).toBe(first.connection.id)
    expect(store.list()).toHaveLength(1)
  })

  it('keeps identity and metadata when a connection is removed', async () => {
    const first = await enroll({ harnessId: 'same' })
    store.remove(first.connection.id)
    expect(store.active()).toBeUndefined()

    const second = await enroll({ harnessId: 'same', adapterId: 'new-adapter' })
    expect(second.connection.id).not.toBe(first.connection.id)
    expect(store.list()).toHaveLength(1)
  })

  it('rejects an expired or reused pairing code', async () => {
    const pairing = await store.createPairing({ kind: 'opencode', label: 'OpenCode' })
    const input = {
      pairId: pairing.id,
      pairToken: pairing.token,
      harnessId: 'harness-a',
      kind: 'opencode',
      label: 'OpenCode',
      adapterId: 'adapter-a',
      key: generateKey(),
      adapterVersion: '0.1.0',
      protocolVersion: 1,
      capabilities: {},
      transport: 'local' as const,
    }
    await store.enroll(input)
    await expect(
      store.enroll({ ...input, harnessId: 'harness-b', adapterId: 'adapter-b', key: generateKey() })
    ).rejects.toBeInstanceOf(HarnessValidationError)
  })
})
