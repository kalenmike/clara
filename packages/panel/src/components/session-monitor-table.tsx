import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PanelSession, PanelSessionState } from '@clara/shared-types'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CopyButton, EmptyState, KeyValue, type Tone } from './primitives.tsx'

const STATE: Record<PanelSessionState, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info' },
  'awaiting-input': { label: 'Needs input', tone: 'warning' },
  idle: { label: 'Idle', tone: 'neutral' },
}

export function SessionMonitorTable({
  sessions,
  now,
  empty,
}: {
  sessions: PanelSession[]
  now: number
  empty: string
}) {
  const { masked } = usePeek()
  const [expanded, setExpanded] = useState<string | undefined>()

  if (sessions.length === 0) return <EmptyState>{empty}</EmptyState>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-2 py-2 font-medium">
              State
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Session
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Harness
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Agent
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Directory
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Updated
            </th>
            <th scope="col" className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const key = `${session.harnessID}:${session.id}`
            const open = expanded === key
            return (
              <SessionRow
                key={key}
                session={session}
                open={open}
                masked={masked}
                now={now}
                onToggle={() => setExpanded(open ? undefined : key)}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SessionRow({
  session,
  open,
  masked,
  now,
  onToggle,
}: {
  session: PanelSession
  open: boolean
  masked: boolean
  now: number
  onToggle: () => void
}) {
  const state = STATE[session.state]
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-border transition hover:bg-accent border-border hover:bg-accent ${
          open ? 'bg-muted' : ''
        }`}
        onClick={onToggle}
      >
        <td className="px-2 py-2">
          <Badge tone={state.tone}>{state.label}</Badge>
        </td>
        <td className="max-w-[320px] px-2 py-2">
          <div className="truncate font-medium text-foreground">
            {session.title?.trim() || '(untitled session)'}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <code className="font-mono text-[10px] text-muted-foreground">
              {masked ? PEEK_MASK : shortId(session.id)}
            </code>
            {session.archived ? <Badge tone="neutral">archived</Badge> : null}
            {session.snoozed ? <Badge tone="warning">snoozed</Badge> : null}
          </div>
        </td>
        <td className="px-2 py-2">
          <div className="font-medium">{session.harnessLabel}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{session.harnessKind}</div>
        </td>
        <td className="px-2 py-2">{session.agent ?? '—'}</td>
        <td
          className="max-w-[260px] truncate px-2 py-2 font-mono text-[11px] text-foreground"
          title={masked ? undefined : session.directory}
        >
          {masked ? PEEK_MASK : session.directory}
        </td>
        <td className="px-2 py-2 text-foreground" title={formatTimestamp(session.updatedAt)}>
          {formatRelative(session.updatedAt, now)}
        </td>
        <td className="px-2 py-2 text-right">
          <ChevronDown
            className={`mx-auto size-3.5 text-muted-foreground transition ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-border bg-muted">
          <td colSpan={7} className="px-3 py-3">
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
              <div>
                <KeyValue label="Session ID" mono>
                  <span className="inline-flex items-center gap-2">
                    {masked ? PEEK_MASK : session.id}
                    {masked ? null : <CopyButton value={session.id} />}
                  </span>
                </KeyValue>
                <KeyValue label="Harness" mono>
                  {session.harnessLabel} · {session.harnessKind}
                </KeyValue>
                <KeyValue label="Model" mono>
                  {session.model ?? '—'}
                </KeyValue>
                <KeyValue label="Project" mono>
                  {session.projectID ?? '—'}
                </KeyValue>
              </div>
              <div>
                <KeyValue label="Directory" mono>
                  <span className="inline-flex items-center gap-2">
                    {masked ? PEEK_MASK : session.directory}
                    {masked ? null : <CopyButton value={session.directory} />}
                  </span>
                </KeyValue>
                <KeyValue label="Parent session" mono>
                  {session.parentID ? (masked ? PEEK_MASK : session.parentID) : 'root session'}
                </KeyValue>
                <KeyValue label="Created">{formatTimestamp(session.createdAt)}</KeyValue>
                <KeyValue label="Updated">{formatTimestamp(session.updatedAt)}</KeyValue>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
