import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateKey, importSessionKey } from '@clara/crypto'
import { canStoreDeviceKey, clearDevice, loadDevice, saveDevice } from './device-store.ts'

describe('device store', () => {
  beforeEach(async () => {
    await clearDevice()
  })

  it('stores a non-extractable key and reads it back', async () => {
    const key = await importSessionKey(generateKey())
    await saveDevice({
      deviceId: 'device-1',
      label: 'Test device',
      wsUrl: 'wss://relay.example/room/room-1',
      room: 'room-1',
      clientToken: 'client',
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    const loaded = await loadDevice()
    expect(loaded).toMatchObject({
      deviceId: 'device-1',
      label: 'Test device',
      room: 'room-1',
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
      clientToken: 'local',
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
      wsUrl: 'wss://relay.example/room/room-1',
      room: 'room-1',
      clientToken: 'client',
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    })

    expect(await canStoreDeviceKey()).toBe(true)
    expect((await loadDevice())?.deviceId).toBe('device-3')
  })
})
