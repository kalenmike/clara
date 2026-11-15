import { useMemo, useState } from 'react'
import { ListChecks, RefreshCw, Search } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Card, CardHeader } from '@clara/ui/components/card'
import { Input } from '@clara/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import type { PanelSession, PanelSessionHarness, PanelSessionsResponse } from '@clara/shared-types'
import { usePeek } from '../../lib/peek-context.tsx'
import { usePanelSessions } from '../../lib/use-panel-sessions.ts'
import { Badge, Notice, Toggle } from '../primitives.tsx'
import { SessionMonitorTable } from '../session-monitor-table.tsx'
import { View } from '../shell/view.tsx'

export function SessionsView({ active, now }: { active: boolean; now: number }) {
  const { redact } = usePeek()
  const [search, setSearch] = useState('')
  const [harnessID, setHarnessID] = useState('all')
  const [runningOnly, setRunningOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data, error, loading, refreshing, refresh } = usePanelSessions({
    enabled: active,
    ...(harnessID === 'all' ? {} : { harnessID }),
    runningOnly,
    includeArchived,
  })

  const sessions = useMemo(() => filterSessions(data?.sessions ?? [], search), [data, search])
  const running = data?.sessions.filter((session) => session.state === 'running').length ?? 0
  const online = data?.harnesses.filter((harness) => harness.online).length ?? 0

  return (
    <View
      id="sessions"
      kicker="Agents"
      title="Sessions"
      description="Live and recently idle sessions across every paired harness. Use this to find runaway or forgotten work."
      actions={
        <>
          <Badge tone={running > 0 ? 'info' : 'neutral'}>{running} running</Badge>
          <Badge tone={online > 0 ? 'success' : 'neutral'}>
            {online}/{data?.harnesses.length ?? 0} online
          </Badge>
          <Button type="button" variant="outline" onClick={refresh} disabled={!active}>
            <RefreshCw
              className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="panel-button-label">{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? (
          <Notice tone={data ? 'warning' : 'danger'}>
            {data ? `Showing the last result. ${redact(error)}` : redact(error)}
          </Notice>
        ) : null}

        <HarnessSummary harnesses={data?.harnesses ?? []} />

        <Card>
          <CardHeader className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
              <label className="relative min-w-[220px] flex-1 text-[11px]">
                <span className="sr-only">Search sessions</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter by title, agent, directory, ID, or harness"
                  className="pl-7"
                />
              </label>
              <label className="text-[11px]">
                <span className="sr-only">Filter by harness</span>
                <Select value={harnessID} onValueChange={setHarnessID}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All harnesses</SelectItem>
                    {(data?.harnesses ?? []).map((harness) => (
                      <SelectItem key={harness.harnessID} value={harness.harnessID}>
                        {harness.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-foreground">
                <Toggle
                  checked={runningOnly}
                  onChange={() => setRunningOnly((value) => !value)}
                  label="Show running sessions only"
                />
                Running only
              </label>
              <label className="flex items-center gap-2 text-[11px] text-foreground">
                <Toggle
                  checked={includeArchived}
                  onChange={() => setIncludeArchived((value) => !value)}
                  label="Include archived sessions"
                />
                Show archived
              </label>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden="true" />
              {sessions.length} shown
              {data?.truncated ? ' · capped' : ''}
            </div>
          </CardHeader>

          <SessionMonitorTable
            sessions={sessions}
            now={now}
            empty={emptyMessage(data, loading, Boolean(search), harnessID !== 'all')}
          />
        </Card>
      </div>
    </View>
  )
}

function HarnessSummary({ harnesses }: { harnesses: PanelSessionHarness[] }) {
  const { redact } = usePeek()
  if (harnesses.length === 0) {
    return (
      <Card className="px-3 py-2.5 text-xs text-muted-foreground">
        No harness is paired. Add one from Harness.
      </Card>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {harnesses.map((harness) => {
        const tone = !harness.online ? 'danger' : harness.ok ? 'success' : 'warning'
        return (
          <Card key={harness.harnessID} className="px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-xs font-semibold">{harness.label}</span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{harness.kind}</div>
              </div>
              <Badge tone={tone}>
                {!harness.online
                  ? 'offline'
                  : harness.ok
                    ? 'online'
                    : harness.code === 'disabled'
                      ? 'disabled'
                      : 'partial'}
              </Badge>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-foreground">
              <span>{harness.sessionCount} sessions</span>
              <span>{harness.runningCount} running</span>
            </div>
            {harness.message ? (
              <p className="mt-1 text-[10px] text-muted-foreground">{redact(harness.message)}</p>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}

function filterSessions(sessions: PanelSession[], search: string): PanelSession[] {
  const text = search.trim().toLowerCase()
  if (!text) return sessions
  return sessions.filter((session) =>
    [
      session.title,
      session.agent,
      session.id,
      session.directory,
      session.model,
      session.harnessLabel,
      session.harnessKind,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(text)
  )
}

function emptyMessage(
  data: PanelSessionsResponse | undefined,
  loading: boolean,
  hasSearch: boolean,
  harnessFiltered: boolean
): string {
  if (!data)
    return loading ? 'Reading sessions from paired harnesses…' : 'No session data available.'
  if (data.harnesses.length === 0) return 'No harness is paired. Add one from Harness.'
  if (data.harnesses.every((harness) => harness.code === 'disabled')) {
    return 'Harness access is disabled. Enable it from Harness, then refresh.'
  }
  if (!data.harnesses.some((harness) => harness.online)) {
    return 'No paired harness is online. Start an adapter and refresh.'
  }
  if (hasSearch || harnessFiltered || data.sessions.length === 0) {
    return 'No sessions match these filters.'
  }
  return 'No sessions were reported by the paired harnesses.'
}
