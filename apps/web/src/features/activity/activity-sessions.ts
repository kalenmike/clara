import type {
  ClaraActivityHarness,
  ClaraActivitySession,
  ClaraTokenUsage,
} from '@clara/api-contract'

export type ActivityHarnessGroup = {
  harness: ClaraActivityHarness
  sessions: ClaraActivitySession[]
}

export type ActivityTotals = {
  sessions: number
  harnesses: number
  inbox: number
  outbox: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  tokens: number
  cost: number
}

export function groupActivitySessions(
  data: readonly ClaraActivitySession[],
  harnesses: readonly ClaraActivityHarness[]
): { groups: ActivityHarnessGroup[]; idle: ClaraActivityHarness[] } {
  const byHarness = new Map<string, ClaraActivitySession[]>()
  for (const item of data) {
    const current = byHarness.get(item.harnessID) ?? []
    current.push(item)
    byHarness.set(item.harnessID, current)
  }

  const ordered = [...harnesses].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.harnessID.localeCompare(right.harnessID)
  )
  const groups = ordered.flatMap((harness): ActivityHarnessGroup[] => {
    const sessions = byHarness.get(harness.harnessID)
    if (!sessions || sessions.length === 0) return []
    return [{ harness, sessions: [...sessions].sort(compareActivitySessions) }]
  })

  return {
    groups,
    idle: ordered.filter((harness) => !byHarness.has(harness.harnessID)),
  }
}

export function sumActivityUsage(data: readonly ClaraActivitySession[]): ActivityTotals {
  const totals: ActivityTotals = {
    sessions: data.length,
    harnesses: new Set(data.map((item) => item.harnessID)).size,
    inbox: 0,
    outbox: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
  }

  for (const item of data) {
    if (item.mailbox === 'inbox') totals.inbox += 1
    else totals.outbox += 1
    addTokens(totals, item.session.tokens)
    totals.cost += item.session.cost
  }
  totals.tokens =
    totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite
  return totals
}

export function activitySessionPath(
  item: ClaraActivitySession,
  harness: ClaraActivityHarness | undefined,
  projectIDs: ReadonlySet<string>
): string | null {
  if (!harness?.active || !projectIDs.has(item.session.projectID)) return null
  return `/p/${item.session.projectID}/s/${item.session.id}`
}

/** Cards keep their position: oldest first, then new sessions append. */
function compareActivitySessions(left: ClaraActivitySession, right: ClaraActivitySession): number {
  return (
    left.session.time.created - right.session.time.created ||
    left.session.id.localeCompare(right.session.id)
  )
}

function addTokens(totals: ActivityTotals, tokens: ClaraTokenUsage | undefined) {
  if (!tokens) return
  totals.input += tokens.input
  totals.output += tokens.output
  totals.reasoning += tokens.reasoning
  totals.cacheRead += tokens.cache.read
  totals.cacheWrite += tokens.cache.write
}
