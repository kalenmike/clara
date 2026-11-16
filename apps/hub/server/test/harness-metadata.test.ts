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

  it('advances the viewed watermark and ignores a stale report', () => {
    metadata.ensureSession('harness-a', 's1', 'p1')

    metadata.setViewed('harness-a', 's1', 100)
    expect(metadata.session('harness-a', 's1').viewedAt).toBe(100)

    metadata.setViewed('harness-a', 's1', 50)
    expect(metadata.session('harness-a', 's1').viewedAt).toBe(100)

    metadata.setViewed('harness-a', 's1', 150)
    expect(metadata.session('harness-a', 's1').viewedAt).toBe(150)
  })

  it('overlays the newer viewed watermark from either side', () => {
    metadata.setViewed('harness-a', 's1', 20)
    const hubAhead = metadata.overlaySession('harness-a', {
      ...session(),
      time: { created: 1, updated: 30, idle: 30, viewed: 10 },
    })
    expect(hubAhead.time).toMatchObject({ created: 1, updated: 30, idle: 30, viewed: 20 })

    const harnessAhead = metadata.overlaySession('harness-a', {
      ...session(),
      time: { created: 1, updated: 40, idle: 40, viewed: 40 },
    })
    expect(harnessAhead.time.viewed).toBe(40)
  })

  it('keeps the archived and viewed overlays together', () => {
    metadata.setArchived('harness-a', 's1', true)
    metadata.setViewed('harness-a', 's1', 50)

    const overlaid = metadata.overlaySession('harness-a', {
      ...session(),
      time: { created: 1, updated: 60, idle: 60 },
    })
    expect(overlaid.time.viewed).toBe(50)
    expect(typeof overlaid.time.archived).toBe('number')
  })
})
