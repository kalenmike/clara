import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AdapterHostIdentity, HarnessInstallMethod } from '@clara/shared-types'
import { fingerprintKey, generateKey, generateSecretKey, loadSecretKey } from '@clara/crypto'
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
  host?: AdapterHostIdentity
  installMethod?: HarnessInstallMethod
}) {
  const pairing = await store.createPairing({
    kind: input.kind ?? 'opencode',
    label: input.label ?? 'OpenCode',
    ...(input.installMethod ? { installMethod: input.installMethod } : {}),
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
    ...(input.host ? { host: input.host } : {}),
  })
}

describe('harness store', () => {
  it('creates an adapter connection and stores its credential', async () => {
    const key = generateKey()
    const result = await enroll({ key })
    expect(result.connection.credentialConfigured).toBe(true)
    expect(result.connection.fingerprint).toBe(await fingerprintKey(key))
    expect(store.list()[0]?.id).toBe(result.connection.id)
    expect(store.list()[0]?.fingerprint).toBe(await fingerprintKey(key))
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

  it('clears persisted online state when the hub starts', async () => {
    const result = await enroll({})
    store.setOnline(result.connection.harnessId, true)
    expect(store.list()[0]?.online).toBe(true)

    store.resetOnline()
    expect(store.list()[0]?.online).toBe(false)
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
    expect(store.list()).toHaveLength(0)

    const second = await enroll({ harnessId: 'same', adapterId: 'new-adapter' })
    expect(second.connection.id).not.toBe(first.connection.id)
    expect(store.list()).toHaveLength(1)
  })

  it('stores the reported host and the install method from the pairing', async () => {
    const result = await enroll({
      host: { hostname: 'build-box', platform: 'linux', arch: 'x64' },
      installMethod: 'ssh',
    })
    expect(result.connection.host).toEqual({
      hostname: 'build-box',
      platform: 'linux',
      arch: 'x64',
      installMethod: 'ssh',
    })
  })

  it('refreshes a host on reconnect without changing the install method', async () => {
    const first = await enroll({
      harnessId: 'same',
      host: { hostname: 'old-name', platform: 'linux' },
      installMethod: 'docker',
    })

    expect(
      store.setHost('same', {
        hostname: 'new-name',
        platform: 'linux',
        arch: 'arm64',
        container: { runtime: 'docker' },
      })
    ).toBe(true)
    expect(store.get(first.connection.id)?.host).toEqual({
      hostname: 'new-name',
      platform: 'linux',
      arch: 'arm64',
      container: { runtime: 'docker' },
      installMethod: 'docker',
    })
    expect(
      store.setHost('same', {
        hostname: 'new-name',
        platform: 'linux',
        arch: 'arm64',
        container: { runtime: 'docker' },
      })
    ).toBe(false)
  })

  it('keeps a known host when a re-pair omits one', async () => {
    const first = await enroll({
      harnessId: 'same',
      host: { hostname: 'build-box', platform: 'linux' },
      installMethod: 'ssh',
    })
    const second = await enroll({ harnessId: 'same', adapterId: 'adapter-b' })
    expect(second.connection.host).toEqual(first.connection.host)
  })

  it('drops malformed host fields instead of storing them', async () => {
    const result = await enroll({
      host: {
        hostname: `bad\u0000name`,
        platform: 'linux',
        arch: 'x64',
        container: { runtime: 'other' },
      },
    })
    expect(result.connection.host).toEqual({
      hostname: 'badname',
      platform: 'linux',
      arch: 'x64',
      container: { runtime: 'other' },
    })
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
