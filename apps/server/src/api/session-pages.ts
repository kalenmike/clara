import type { ClaraSession, ClaraSessionsResponse } from '@clara/api-contract'

/** One linked harness project's page, tagged with the project that returned it. */
export type SessionPage = ClaraSessionsResponse & { projectID: string }

/**
 * The hub-owned cursor for a project linked to more than one harness record.
 * Each record keeps its own opaque cursor; the hub stores them together so
 * pagination stays complete instead of dropping or repeating a record's page.
 *
 * A missing key means "first page"; `null` means that record is exhausted.
 */
export type MergedSessionCursor = {
  v: 1
  projects: Record<string, string | null>
}

export function decodeMergedSessionCursor(
  value: string | undefined
): MergedSessionCursor | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.projects)) return undefined
    const projects: Record<string, string | null> = {}
    for (const [key, item] of Object.entries(parsed.projects)) {
      if (item !== null && typeof item !== 'string') return undefined
      projects[key] = item
    }
    return { v: 1, projects }
  } catch {
    return undefined
  }
}

/**
 * Merge pages returned for every harness record linked to one Clara project.
 * Records can overlap, so sessions are deduplicated by id and ordered by the
 * harness's requested direction. Each record is fetched with the requested
 * limit, so a multi-record project may return more than `limit` rows per page;
 * the cursor still advances all records exactly once.
 */
export function mergeSessionPages(
  pages: SessionPage[],
  order: 'asc' | 'desc' | undefined
): ClaraSessionsResponse {
  const byID = new Map<string, ClaraSession>()
  for (const page of pages) {
    for (const session of page.data) {
      if (!byID.has(session.id)) byID.set(session.id, session)
    }
  }

  const direction = order === 'asc' ? 1 : -1
  const data = [...byID.values()].sort((a, b) => {
    const byTime = a.time.updated - b.time.updated
    if (byTime !== 0) return direction * byTime
    return a.id.localeCompare(b.id)
  })

  return {
    data,
    cursor: {
      previous: cursorEnvelope(pages, 'previous'),
      next: cursorEnvelope(pages, 'next'),
    },
  }
}

function cursorEnvelope(pages: SessionPage[], direction: 'previous' | 'next'): string | null {
  const cursors: Record<string, string | null> = {}
  let hasCursor = false
  for (const page of pages) {
    const cursor = page.cursor?.[direction] ?? null
    cursors[page.projectID] = cursor
    if (cursor !== null) hasCursor = true
  }
  if (!hasCursor) return null
  return Buffer.from(JSON.stringify({ v: 1, projects: cursors }), 'utf8').toString('base64url')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
