import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { HarnessMetadataStore } from '../src/harness/metadata.ts'
import { ProjectStore } from '../src/projects/store.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let metadata: HarnessMetadataStore

function session(id = 's1'): ClaraSession {
  return {
    id,
    projectID: 'harness-project',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    location: { directory: '/workspace/demo' },
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-harness-metadata-'))
  db = openDatabase(join(dir, 'clara.db'))
  const insertIdentity = db.prepare(
    `INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?)`
  )
  insertIdentity.run('harness-a', 'opencode', 1, 1)
  insertIdentity.run('harness-b', 'opencode', 1, 1)
  const projects = new ProjectStore(db)
  metadata = new HarnessMetadataStore(db, projects)
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('harness session metadata', () => {
  it('stamps the owning harness on an overlaid session', () => {
    const overlaid = metadata.overlaySession('harness-a', session())
    expect(overlaid.harnessID).toBe('harness-a')
  })

  it('resolves the recorded harness for a session', () => {
    metadata.ensureSession('harness-b', 's-b', 'p1')
    expect(metadata.harnessIdForSession('s-b')).toBe('harness-b')
    expect(metadata.harnessIdForSession('missing')).toBeUndefined()
  })
})
