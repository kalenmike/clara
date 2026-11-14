import { generateKey, importSessionKey } from '@clara/crypto'

const DATABASE_NAME = 'clara-devices'
const DATABASE_VERSION = 1
const STORE_NAME = 'device'
const RECORD_KEY = 'current'
const PROBE_KEY = 'probe'

export type StoredDevice = {
  deviceId: string
  label: string
  wsUrl: string
  room: string
  /**
   * The device's relay grant, presented as `clara.auth.<grant>`. Local pairings
   * have no relay credential and store an empty string.
   */
  grant: string
  /** Unix milliseconds. Zero for a local pairing, which never expires. */
  grantExpiresAt: number
  fingerprint: string
  key: CryptoKey
  createdAt: number
}

type StoredRecord = StoredDevice & { id: string }

export async function loadDevice(
  options: { allowExpired?: boolean } = {}
): Promise<StoredDevice | null> {
  const db = await openDatabase()
  try {
    const record = await request<StoredRecord | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY)
    )
    if (!record) return null
    // A record written before grants has no grant fields at all; make the
    // browser pair again rather than retrying a credential the relay rejects.
    if (typeof record.grant !== 'string' || typeof record.grantExpiresAt !== 'number') return null
    // A relay device is useless once its grant expires: the relay refuses the
    // upgrade before the hub ever sees the key. Fall back to the pairing screen.
    // Local pairings carry no relay grant, so only their presence is required.
    // A live session must still be able to write the refreshed grant it was
    // just handed, even if the previous one expires during the handshake.
    if (
      !options.allowExpired &&
      record.room !== 'local' &&
      (!record.grant ||
        !Number.isFinite(record.grantExpiresAt) ||
        record.grantExpiresAt <= Date.now())
    ) {
      return null
    }
    const { id: _id, ...device } = record
    return device
  } finally {
    db.close()
  }
}

export async function saveDevice(device: StoredDevice): Promise<void> {
  const db = await openDatabase()
  try {
    await request(
      db
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({ ...device, id: RECORD_KEY } satisfies StoredRecord)
    )
  } finally {
    db.close()
  }
}

export async function clearDevice(): Promise<void> {
  const db = await openDatabase()
  try {
    await request(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(RECORD_KEY)
    )
  } finally {
    db.close()
  }
}

/**
 * Verify that this browser can persist a non-extractable CryptoKey before a
 * pairing code is consumed. If it cannot, the connect screen explains why
 * instead of leaving the user with a device the hub enrolled but the browser
 * cannot use.
 */
export async function canStoreDeviceKey(): Promise<boolean> {
  try {
    const key = await importSessionKey(generateKey())
    const probe: StoredRecord = {
      id: PROBE_KEY,
      deviceId: 'probe',
      label: 'probe',
      wsUrl: 'ws://probe',
      room: 'local',
      grant: '',
      grantExpiresAt: 0,
      fingerprint: 'probe',
      key,
      createdAt: Date.now(),
    }
    const db = await openDatabase()
    try {
      const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
      await request(store.put(probe))
      const stored = await request<StoredRecord | undefined>(store.get(PROBE_KEY))
      await request(store.delete(PROBE_KEY))
      return stored?.key instanceof CryptoKey
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support IndexedDB'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the Clara device store'))
    request.onblocked = () => reject(new Error('The Clara device store is blocked'))
  })
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('The Clara device store failed'))
  })
}
