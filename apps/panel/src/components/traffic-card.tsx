import { useState } from 'react'
import { Activity } from 'lucide-react'
import type {
  PanelMonitoringControl,
  PanelTraffic,
  PanelTrafficErrorKey,
  PanelTrafficSpike,
} from '@clara/shared-types'
import { formatBytes, formatRelative, formatTimestamp } from '../lib/format.ts'
import { postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  EmptyState,
  KeyValue,
  Notice,
  Toggle,
} from './primitives.tsx'

const SPIKE_LABELS: Record<PanelTrafficSpike, string> = {
  bytes: 'bandwidth',
  requests: 'requests',
  errors: 'errors',
}

const ERROR_LABELS: Array<[PanelTrafficErrorKey, string]> = [
  ['handshake', 'Failed handshakes'],
  ['crypto', 'Decrypt or replay rejects'],
  ['orphan', 'Frames for unknown sessions'],
  ['dropped', 'Malformed frames'],
  ['refused', 'Refused shell commands'],
  ['limited', 'Request-limit refusals'],
  ['upstream', 'Upstream request errors'],
  ['expired', 'Expired sessions'],
]

type SparkLine = {
  label: string
  values: number[]
  stroke: string
  dot: string
}

export function TrafficCard({
  traffic,
  monitoring,
  onChanged,
  now,
}: {
  traffic: PanelTraffic
  monitoring: PanelMonitoringControl
  onChanged: () => void
  now: number
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const { redact } = usePeek()
  const enabled = monitoring.enabled

  const toggle = async () => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/monitoring', { enabled: !enabled })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const spike = traffic.spike.length > 0
  const tone = !enabled ? 'neutral' : spike ? 'warning' : traffic.warmup ? 'info' : 'success'
  const status = !enabled ? 'Off' : spike ? 'Spike' : traffic.warmup ? 'Collecting' : 'Monitoring'
  const errors = ERROR_LABELS.map(([key, label]) => ({ label, value: traffic.errors[key] }))
  const totalErrors = errors.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <CollapsibleCard
      title="Traffic"
      description="Bytes, requests, and errors through the agent"
      icon={<Activity className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      expandable={enabled}
      control={
        <Toggle
          checked={enabled}
          onChange={() => void toggle()}
          label={`Traffic monitoring: ${enabled ? 'on' : 'off'}`}
          state={pending ? 'pending' : enabled ? 'on' : 'off'}
          disabled={pending}
          title={enabled ? 'Stop recording traffic counters' : 'Start recording traffic counters'}
        />
      }
      notice={
        error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(error)}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        {traffic.warmup ? (
          <EmptyState>
            Collecting the first minute. Rates and spike detection appear after that.
          </EmptyState>
        ) : (
          <>
            {spike ? (
              <Notice>
                Unusual {traffic.spike.map((reason) => SPIKE_LABELS[reason]).join(' and ')} in the
                last minute compared with the previous half hour. This is a hint, not a verdict.
              </Notice>
            ) : null}
            <KeyValue label="In">{formatRate(traffic.rate.bytesInPerSecond)}</KeyValue>
            <KeyValue label="Out">{formatRate(traffic.rate.bytesOutPerSecond)}</KeyValue>
            <KeyValue label="Requests">{traffic.rate.requestsPerMinute} per minute</KeyValue>
            <KeyValue label="Errors">{traffic.rate.errorsPerMinute} per minute</KeyValue>
            <div className="space-y-2 pt-2">
              <Sparkline
                label="Bytes per minute, received and sent"
                lines={[
                  {
                    label: 'In',
                    values: traffic.series.map((sample) => sample.bytesIn),
                    stroke: 'stroke-sky-500',
                    dot: 'bg-sky-500',
                  },
                  {
                    label: 'Out',
                    values: traffic.series.map((sample) => sample.bytesOut),
                    stroke: 'stroke-emerald-500',
                    dot: 'bg-emerald-500',
                  },
                ]}
              />
              <Sparkline
                label="Requests and errors per minute"
                lines={[
                  {
                    label: 'Requests',
                    values: traffic.series.map((sample) => sample.requests),
                    stroke: 'stroke-neutral-400',
                    dot: 'bg-neutral-400',
                  },
                  {
                    label: 'Errors',
                    values: traffic.series.map((sample) => sample.errors),
                    stroke: 'stroke-red-500',
                    dot: 'bg-red-500',
                  },
                ]}
              />
            </div>
            <div className="pt-2">
              <KeyValue label="Total in">{formatBytes(traffic.totals.bytesIn)}</KeyValue>
              <KeyValue label="Total out">{formatBytes(traffic.totals.bytesOut)}</KeyValue>
              <KeyValue label="Frames">
                {traffic.totals.framesIn} in · {traffic.totals.framesOut} out
              </KeyValue>
              <KeyValue label="Requests">{traffic.totals.requests}</KeyValue>
              <KeyValue label="Sessions">
                {traffic.totals.sessionsOpened} opened · {traffic.totals.sessionsClosed} closed
              </KeyValue>
              <KeyValue label="Peak minute">
                {formatBytes(traffic.peak.bytesIn)} in · {formatBytes(traffic.peak.bytesOut)} out ·{' '}
                {traffic.peak.requests} req
              </KeyValue>
              <KeyValue label="Local transport">
                {formatBytes(
                  traffic.byTransport.local.bytesIn + traffic.byTransport.local.bytesOut
                )}{' '}
                · {traffic.byTransport.local.requests} req
              </KeyValue>
              <KeyValue label="Relay">
                {formatBytes(
                  traffic.byTransport.relay.bytesIn + traffic.byTransport.relay.bytesOut
                )}{' '}
                · {traffic.byTransport.relay.requests} req
              </KeyValue>
              <KeyValue label="Window" title={formatTimestamp(traffic.since)}>
                since {formatRelative(traffic.since, now)}
              </KeyValue>
            </div>
            {totalErrors > 0 ? (
              <div className="pt-2">
                {errors
                  .filter((entry) => entry.value > 0)
                  .map((entry) => (
                    <KeyValue key={entry.label} label={entry.label}>
                      {entry.value}
                    </KeyValue>
                  ))}
              </div>
            ) : (
              <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
                No failed handshakes, rejects, or refused commands since monitoring started.
              </p>
            )}
            <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Counters reset when the agent restarts or monitoring is switched off. History stays in
              the systemd journal and Cloudflare analytics.
            </p>
          </>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}

function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSecond)}/s`
}

function Sparkline({ lines, label }: { lines: SparkLine[]; label: string }) {
  const width = 100
  const height = 28
  const max = Math.max(1, ...lines.flatMap((line) => line.values))

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={label}
      >
        <line
          x1="0"
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          className="stroke-neutral-200 dark:stroke-neutral-800"
          strokeWidth="0.5"
        />
        {lines.map((line) => (
          <path
            key={line.label}
            d={linePath(line.values, max, width, height)}
            fill="none"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
            className={line.stroke}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-neutral-500 dark:text-neutral-400">
        {lines.map((line) => (
          <span key={line.label} className="inline-flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${line.dot}`} aria-hidden="true" />
            {line.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function linePath(values: number[], max: number, width: number, height: number): string {
  if (values.length === 0) return ''
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width
      const y = height - (Math.max(0, value) / max) * height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
