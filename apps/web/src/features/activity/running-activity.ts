import type {
  ClaraActivityHarness,
  ClaraRunningSession,
  ClaraTokenUsage,
} from '@clara/api-contract'

export type RunningHarnessGroup = {
  harness: ClaraActivityHarness
  sessions: ClaraRunningSession[]
}

export type RunningTotals = {
  sessions: number
  harnesses: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  tokens: number
  cost: number
}

export function groupRunningSessions(
  data: readonly ClaraRunningSession[],
  harnesses: readonly ClaraActivityHarness[]
): { groups: RunningHarnessGroup[]; idle: ClaraActivityHarness[] } {
  const byHarness = new Map<string, ClaraRunningSession[]>()
  for (const item of data) {
    const current = byHarness.get(item.harnessID) ?? []
    current.push(item)
    byHarness.set(item.harnessID, current)
  }

  const groups = harnesses.flatMap((harness): RunningHarnessGroup[] => {
    const sessions = byHarness.get(harness.harnessID)
    return sessions && sessions.length > 0 ? [{ harness, sessions }] : []
  })

  return {
    groups,
    idle: harnesses.filter((harness) => !byHarness.has(harness.harnessID)),
  }
}

export function sumRunningUsage(data: readonly ClaraRunningSession[]): RunningTotals {
  const totals: RunningTotals = {
    sessions: data.length,
    harnesses: new Set(data.map((item) => item.harnessID)).size,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
  }

  for (const item of data) {
    addTokens(totals, item.session.tokens)
    totals.cost += item.session.cost
  }
  totals.tokens =
    totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite
  return totals
}

export function runningSessionPath(
  item: ClaraRunningSession,
  harness: ClaraActivityHarness | undefined,
  projectIDs: ReadonlySet<string>
): string | null {
  if (!harness?.active || !projectIDs.has(item.session.projectID)) return null
  return `/p/${item.session.projectID}/s/${item.session.id}`
}

function addTokens(totals: RunningTotals, tokens: ClaraTokenUsage | undefined) {
  if (!tokens) return
  totals.input += tokens.input
  totals.output += tokens.output
  totals.reasoning += tokens.reasoning
  totals.cacheRead += tokens.cache.read
  totals.cacheWrite += tokens.cache.write
}
