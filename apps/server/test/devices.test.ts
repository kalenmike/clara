import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateKey, generateSecretKey, loadSecretKey } from '@clara/crypto'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'
import { DeviceStore } from '../src/store/devices.ts'

const databases: ClaraDatabase[] = []
const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-devices-'))
  tempDirs.push(dir)
  return dir
}

async function createStore(): Promise<DeviceStore> {
  const db = openDatabase(join(tempDir(), 'clara.db'))
  databases.push(db)
  const key = await loadSecretKey(generateSecretKey())
  return new DeviceStore({ db, key, keyVersion: 1 })
}

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('DeviceStore', () => {
  it('enrolls one device from a pairing token and finds its key', async () => {
    const store = await createStore()
    const token = await store.createPairingToken()
    const key = generateKey()

    const device = await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key,
      label: 'Desk',
      transport: 'local',
    })

    expect(device).toMatchObject({ id: 'device-0000000000001', label: 'Desk' })
    expect(await store.findActiveDevice('device-0000000000001')).toMatchObject({
      id: 'device-0000000000001',
      key,
      label: 'Desk',
    })
    expect(store.isActive('device-0000000000001')).toBe(true)
    expect(store.countActive()).toBe(1)
    expect(await store.findPairingToken(token.id)).toBeUndefined()
  })

  it('treats a retry from the same device as idempotent', async () => {
    const store = await createStore()
    const token = await store.createPairingToken()
    const key = generateKey()

    await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key,
      label: 'Desk',
    })
    const retry = await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key,
      label: 'Desk',
    })

    expect(retry.id).toBe('device-0000000000001')
    expect(store.countActive()).toBe(1)
  })

  it('rejects a second device using the same pairing token', async () => {
    const store = await createStore()
    const token = await store.createPairingToken()

    await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key: generateKey(),
      label: 'Desk',
    })

    await expect(
      store.enrollDevice({
        pairingTokenId: token.id,
        deviceId: 'device-0000000000002',
        key: generateKey(),
        label: 'Phone',
      })
    ).rejects.toMatchObject({ code: 'enrollment_used' })
  })

  it('rejects expired pairing tokens', async () => {
    const store = await createStore()
    const token = await store.createPairingToken(1)
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(await store.findPairingToken(token.id)).toBeUndefined()
    await expect(
      store.enrollDevice({
        pairingTokenId: token.id,
        deviceId: 'device-0000000000001',
        key: generateKey(),
        label: 'Desk',
      })
    ).rejects.toMatchObject({ code: 'enrollment_invalid' })
  })

  it('revokes one device without touching another', async () => {
    const store = await createStore()
    const first = await store.createPairingToken()
    const second = await store.createPairingToken()

    await store.enrollDevice({
      pairingTokenId: first.id,
      deviceId: 'device-0000000000001',
      key: generateKey(),
      label: 'Desk',
    })
    await store.enrollDevice({
      pairingTokenId: second.id,
      deviceId: 'device-0000000000002',
      key: generateKey(),
      label: 'Phone',
    })

    expect(store.revokeDevice('device-0000000000001')).toMatchObject({ id: 'device-0000000000001' })
    expect(store.isActive('device-0000000000001')).toBe(false)
    expect(await store.findActiveDevice('device-0000000000001')).toBeUndefined()
    expect(store.isActive('device-0000000000002')).toBe(true)
    expect(store.countActive()).toBe(1)
    expect(
      store.listDevices().find((device) => device.id === 'device-0000000000001')?.revokedAt
    ).toBeDefined()
  })

  it('purges a revoked device without touching another', async () => {
    const store = await createStore()
    const first = await store.createPairingToken()
    const second = await store.createPairingToken()

    await store.enrollDevice({
      pairingTokenId: first.id,
      deviceId: 'device-0000000000001',
      key: generateKey(),
      label: 'Desk',
    })
    await store.enrollDevice({
      pairingTokenId: second.id,
      deviceId: 'device-0000000000002',
      key: generateKey(),
      label: 'Phone',
    })

    store.revokeDevice('device-0000000000001')
    expect(store.purgeDevice('device-0000000000001')).toMatchObject({
      id: 'device-0000000000001',
      label: 'Desk',
    })
    expect(store.listDevices().map((device) => device.id)).toEqual(['device-0000000000002'])
    expect(store.isActive('device-0000000000002')).toBe(true)
    expect(store.countActive()).toBe(1)
    expect(store.purgeDevice('device-0000000000001')).toBeUndefined()
  })

  it('refuses to purge an active device', async () => {
    const store = await createStore()
    const token = await store.createPairingToken()
    await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key: generateKey(),
      label: 'Desk',
    })

    expect(() => store.purgeDevice('device-0000000000001')).toThrow(
      'Revoke this device before deleting it'
    )
    expect(store.isActive('device-0000000000001')).toBe(true)
  })

  it('revokes every device', async () => {
    const store = await createStore()
    for (const id of ['device-0000000000001', 'device-0000000000002']) {
      const token = await store.createPairingToken()
      await store.enrollDevice({
        pairingTokenId: token.id,
        deviceId: id,
        key: generateKey(),
        label: id,
      })
    }

    expect(store.revokeAllDevices()).toBe(2)
    expect(store.countActive()).toBe(0)
  })

  it('rejects a device id that is already enrolled with another key', async () => {
    const store = await createStore()
    const token = await store.createPairingToken()
    await store.enrollDevice({
      pairingTokenId: token.id,
      deviceId: 'device-0000000000001',
      key: generateKey(),
      label: 'Desk',
    })

    const second = await store.createPairingToken()
    await expect(
      store.enrollDevice({
        pairingTokenId: second.id,
        deviceId: 'device-0000000000001',
        key: generateKey(),
        label: 'Desk',
      })
    ).rejects.toMatchObject({ code: 'invalid_device' })
  })
})
