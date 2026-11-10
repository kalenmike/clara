import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  BACKUP_IMAGE,
  backupArgs,
  defaultBackupPath,
  parseBackupArgs,
  parseRestoreArgs,
  restoreArgs,
} from '../lib/stack-backup.mjs'
import { VOLUMES } from '../lib/stack-control.mjs'

test('builds a timestamped backup path', () => {
  const path = defaultBackupPath(new Date('2026-11-10T12:34:56Z'))
  assert.equal(path, resolve('clara-backup-20261110-123456.tar.gz'))
})

test('parses backup output paths', () => {
  assert.deepEqual(parseBackupArgs([]), { output: defaultBackupPath() })
  assert.deepEqual(parseBackupArgs(['--output', 'backup.tar.gz']), {
    output: resolve('backup.tar.gz'),
  })
  assert.throws(() => parseBackupArgs(['--output']), /requires a path/)
  assert.throws(() => parseBackupArgs(['--watch']), /unknown option/)
})

test('parses restore archives and force', () => {
  assert.deepEqual(parseRestoreArgs(['backup.tar.gz']), {
    archive: resolve('backup.tar.gz'),
    force: false,
  })
  assert.deepEqual(parseRestoreArgs(['backup.tar.gz', '--force']), {
    archive: resolve('backup.tar.gz'),
    force: true,
  })
  assert.throws(() => parseRestoreArgs([]), /requires an archive path/)
  assert.throws(() => parseRestoreArgs(['a.tar.gz', 'b.tar.gz']), /unexpected argument/)
  assert.throws(() => parseRestoreArgs(['--force']), /requires an archive path/)
})

test('mounts every state volume for backup', () => {
  const args = backupArgs(VOLUMES)
  for (const volume of VOLUMES) {
    assert.ok(args.includes(`${volume}:/state/${volume}:ro`))
  }
  assert.deepEqual(args.slice(args.indexOf(BACKUP_IMAGE)), [
    BACKUP_IMAGE,
    'tar',
    'czf',
    '-',
    '-C',
    '/state',
    '.',
  ])
  assert.ok(args.includes('--rm'))
})

test('restores into all volumes with replace semantics', () => {
  const args = restoreArgs(VOLUMES)
  for (const volume of VOLUMES) {
    assert.ok(args.includes(`${volume}:/state/${volume}`))
  }
  assert.ok(args.includes('-i'))
  assert.ok(
    args.includes('find /state -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf - -C /state')
  )
})

test('uses the node image for the one-shot container', () => {
  assert.equal(BACKUP_IMAGE, 'node:22-bookworm-slim')
  assert.ok(backupArgs(VOLUMES).includes(BACKUP_IMAGE))
  assert.ok(restoreArgs(VOLUMES).includes(BACKUP_IMAGE))
})
