// Clara — pipeline ledger integration.
//
// The definition, validation, catalog, hashing, and template code lives in
// @clara/pipelines so the home agent and the plugin read the same rules. This
// module keeps only the ledger-facing helpers that need a database row.

import {
  SOFTWARE_PIPELINE,
  SOFTWARE_PIPELINE_ID,
  loadPipeline,
  parsePipelineSnapshot,
  pipelineHash,
  pipelineSnapshot,
  type Pipeline,
} from '@clara/pipelines'
import type { Db, Row } from './db.ts'

export * from '@clara/pipelines'

/** Pin existing rows that predate pipeline snapshots. Idempotent. */
export function ensurePipelineSnapshots(db: Db): void {
  const snapshot = pipelineSnapshot(SOFTWARE_PIPELINE)
  const hash = pipelineHash(SOFTWARE_PIPELINE)
  db.prepare(
    `UPDATE requests
        SET pipeline_id = COALESCE(pipeline_id, ?),
            pipeline_version = COALESCE(pipeline_version, ?),
            pipeline_hash = COALESCE(pipeline_hash, ?),
            pipeline_snapshot = COALESCE(pipeline_snapshot, ?)
      WHERE pipeline_snapshot IS NULL`
  ).run(SOFTWARE_PIPELINE.id, SOFTWARE_PIPELINE.version, hash, snapshot)
}

export function pipelineForRequest(db: Db, request: Row): Pipeline {
  if (typeof request.pipeline_snapshot === 'string' && request.pipeline_snapshot.trim()) {
    return parsePipelineSnapshot(request.pipeline_snapshot)
  }
  ensurePipelineSnapshots(db)
  return SOFTWARE_PIPELINE
}

export function selectWorkspacePipeline(db: Db, workspace: string, id: string): string {
  const loaded = loadPipeline(id)
  const row = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(workspace)
  if (!row) throw new Error(`Clara: no workspace "${workspace}"`)
  db.prepare('UPDATE workspaces SET pipeline_id = ?, pipeline_version = ? WHERE id = ?').run(
    loaded.pipeline.id,
    loaded.pipeline.version,
    row.id
  )
  return `${workspace}: pipeline ${loaded.pipeline.id}@${loaded.pipeline.version}`
}

export function workspacePipelineId(workspace: Row): string {
  return typeof workspace.pipeline_id === 'string' && workspace.pipeline_id.trim()
    ? workspace.pipeline_id
    : SOFTWARE_PIPELINE_ID
}
