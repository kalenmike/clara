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
  clientToken: string
  fingerprint: string
  key: CryptoKey
  createdAt: number
}

type StoredRecord = StoredDevice & { id: string }

export async function loadDevice(): Promise<StoredDevice | null> {
  const db = await openDatabase()
  try {
    const record = await request<StoredRecord | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY)
    )
    if (!record) return null
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
 * instead of leaving the user with a device the agent enrolled but the browser
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
      room: 'probe',
      clientToken: 'probe',
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
