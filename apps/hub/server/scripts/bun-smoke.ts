import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, schemaVersion } from '../src/store/database.ts'

/**
 * Bun-only smoke test for the runtime-specific SQLite driver. The normal test
 * suite runs on Node; this exercises the same migrations, pragma shim, BLOB
 * normalization, and transactions under bun:sqlite.
 *
 *   bun scripts/bun-smoke.ts
 */
const dir = mkdtempSync(join(tmpdir(), 'clara-bun-smoke-'))
const path = join(dir, 'clara.db')

try {
  const db = openDatabase(path)
  const version = schemaVersion(db)
  if (version < 1) throw new Error(`unexpected schema version ${version}`)

  db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, blob BLOB)')
  const blob = Buffer.from([1, 2, 3])
  db.prepare('INSERT INTO smoke (blob) VALUES (?)').run(blob)
  const row = db.prepare('SELECT blob FROM smoke').get() as { blob: Buffer }
  if (!Buffer.isBuffer(row.blob)) throw new Error('BLOB was not normalized to a Buffer')
  if (row.blob.toString('base64url') !== blob.toString('base64url')) {
    throw new Error('BLOB round trip changed the value')
  }
  if (db.prepare('SELECT blob FROM smoke WHERE id = ?').get(99) !== undefined) {
    throw new Error('get() did not normalize a missing row to undefined')
  }

  const insert = db.transaction((value: string) => {
    db.prepare(
      'INSERT INTO client_storage (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)'
    ).run('smoke', value, value, Date.now())
    return value
  })
  if (insert('one') !== 'one') throw new Error('transaction did not return its value')

  closeDatabase(db)
  console.log(`bun sqlite smoke passed (schema ${version})`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
