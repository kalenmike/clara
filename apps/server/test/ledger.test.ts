import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerAlert } from '@clara/shared-types'
import { LedgerAlertMonitor } from '../src/clara/ledger/monitor.ts'
import { LedgerReader } from '../src/clara/ledger/reader.ts'
import { LedgerAlertStore } from '../src/clara/ledger/store.ts'
import { closeDatabase, openDatabase } from '../src/store/database.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'clara-ledger-'))
  dirs.push(dir)
  const ledgerPath = join(dir, 'ledger.db')
  const ledger = new Database(ledgerPath)
  ledger.exec(`
    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      feature_id INTEGER,
      slug TEXT,
      workspace TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `)
  ledger
    .prepare(
      `INSERT INTO alerts (key, feature_id, slug, workspace, kind, title, body, created_at, resolved_at)
     VALUES (?, 1, 'demo', 'clara', 'decision', ?, 'details', ?, ?)`
    )
    .run('decision:1', '001 demo · decision', new Date().toISOString(), null)
  ledger
    .prepare(
      `INSERT INTO alerts (key, feature_id, slug, workspace, kind, title, body, created_at, resolved_at)
     VALUES (?, 1, 'demo', 'clara', 'kill', ?, 'details', ?, ?)`
    )
    .run('kill:1:old', '001 demo · stopped', new Date().toISOString(), new Date().toISOString())
  ledger.close()

  const database = openDatabase(join(dir, 'clara.db'))
  return {
    ledgerPath,
    reader: new LedgerReader(ledgerPath),
    store: new LedgerAlertStore(database),
    close: () => closeDatabase(database),
  }
}

function insertAlert(path: string, key: string): void {
  const db = new Database(path)
  try {
    db.prepare(
      `INSERT INTO alerts (key, feature_id, slug, workspace, kind, title, body, created_at)
       VALUES (?, 1, 'demo', 'clara', 'decision', ?, 'details', ?)`
    ).run(key, `001 demo · ${key}`, new Date().toISOString())
  } finally {
    db.close()
  }
}

describe('LedgerReader', () => {
  it('returns open alerts for the inbox and includes resolved rows in the delivery feed', () => {
    const { reader, close } = setup()
    try {
      expect(reader.inbox().items.map((item) => item.key)).toEqual(['decision:1'])
      expect(reader.latestId()).toBe(2)
      expect(reader.newAfter(0).map((row) => row.alert.key)).toEqual(['decision:1', 'kill:1:old'])
    } finally {
      close()
    }
  })

  it('returns empty when the ledger database is missing', () => {
    const reader = new LedgerReader('/tmp/clara-ledger-does-not-exist.db')
    expect(reader.inbox().items).toEqual([])
    expect(reader.latestId()).toBe(0)
  })
})

describe('LedgerAlertMonitor', () => {
  it('primes past old alerts and delivers each new alert once', async () => {
    const { ledgerPath, reader, store, close } = setup()
    const broadcast = vi.fn<(alert: LedgerAlert) => void>()
    const notify = vi.fn().mockResolvedValue(undefined)
    const monitor = new LedgerAlertMonitor({
      reader,
      store,
      push: { notify } as never,
      enabled: () => true,
      canPush: () => true,
      hasClients: () => true,
      broadcast,
    })

    try {
      monitor.start({ prime: true })
      await Promise.resolve()
      expect(store.cursor()).toBe(2)
      expect(broadcast).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledTimes(1) // the one-item summary

      insertAlert(ledgerPath, 'decision:3')
      await monitor.runOnce()
      expect(broadcast).toHaveBeenCalledTimes(1)
      expect(broadcast.mock.calls[0]?.[0].key).toBe('decision:3')
      expect(store.delivered('decision:3')).toBe(true)
      expect(store.cursor()).toBe(3)

      await monitor.runOnce()
      expect(broadcast).toHaveBeenCalledTimes(1)
    } finally {
      monitor.stop()
      close()
    }
  })

  it('does nothing while Clara management is disabled', async () => {
    const { reader, store, close } = setup()
    const broadcast = vi.fn()
    const monitor = new LedgerAlertMonitor({
      reader,
      store,
      enabled: () => false,
      broadcast,
    })
    try {
      monitor.start()
      await monitor.runOnce()
      expect(broadcast).not.toHaveBeenCalled()
    } finally {
      monitor.stop()
      close()
    }
  })
})
