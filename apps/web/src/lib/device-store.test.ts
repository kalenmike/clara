import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateKey, importSessionKey } from '@clara/crypto'
import { canStoreDeviceKey, clearDevice, loadDevice, saveDevice } from './device-store.ts'

const RELAY_URL = 'wss://relay.example/room/room-1'
const GRANT = 'encoded.signature'

describe('device store', () => {
  beforeEach(async () => {
    await clearDevice()
  })

  it('stores a non-extractable key and reads it back', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-1',
      label: 'Test device',
      wsUrl: RELAY_URL,
      room: 'room-1',
      grant: GRANT,
      grantExpiresAt: Date.now() + 60_000,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    const loaded = await loadDevice()
    expect(loaded).toMatchObject({
      deviceId: 'device-1',
      label: 'Test device',
      room: 'room-1',
      grant: GRANT,
      fingerprint: 'fingerprint',
    })
    expect(loaded?.key).toBeInstanceOf(CryptoKey)
    expect(loaded?.key.extractable).toBe(false)
  })

  it('clears the stored device', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-2',
      label: 'Test device',
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      grant: '',
      grantExpiresAt: 0,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })
    await clearDevice()
    expect(await loadDevice()).toBeNull()
  })

  it('verifies that this runtime can persist a protected key', async () => {
    expect(await canStoreDeviceKey()).toBe(true)
    expect(await loadDevice()).toBeNull()
  })

  it('does not overwrite an existing device during the capability probe', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-3',
      label: 'Test device',
      wsUrl: RELAY_URL,
      room: 'room-1',
      grant: GRANT,
      grantExpiresAt: Date.now() + 60_000,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect(await canStoreDeviceKey()).toBe(true)
    expect((await loadDevice())?.deviceId).toBe('device-3')
  })

  it('forgets a relay device with no stored grant', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-legacy',
      label: 'Legacy device',
      wsUrl: RELAY_URL,
      room: 'room-1',
      // A record from before grants has no grant fields; simulate the missing
      // fields on the wire shape the browser wrote.
      grant: undefined as unknown as string,
      grantExpiresAt: undefined as unknown as number,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect(await loadDevice()).toBeNull()
  })

  it('forgets a relay device whose grant has expired', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-expired',
      label: 'Expired device',
      wsUrl: RELAY_URL,
      room: 'room-1',
      grant: GRANT,
      grantExpiresAt: Date.now() - 1,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect(await loadDevice()).toBeNull()
  })

  it('can read an expired record only to write a refreshed grant', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-refresh',
      label: 'Refresh device',
      wsUrl: RELAY_URL,
      room: 'room-1',
      grant: GRANT,
      grantExpiresAt: Date.now() - 1,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect(await loadDevice()).toBeNull()
    expect((await loadDevice({ allowExpired: true }))?.deviceId).toBe('device-refresh')
  })

  it('keeps a local device without a relay grant', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-local',
      label: 'Local device',
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      grant: '',
      grantExpiresAt: 0,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect((await loadDevice())?.deviceId).toBe('device-local')
  })
})
