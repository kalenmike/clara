import { Gauge } from 'lucide-react'
import type { HostDiskMetrics, HostResourceMetrics, PanelHarness } from '@clara/shared-types'
import {
  formatBytes,
  formatPercent,
  formatRelative,
  formatTimestamp,
  shortId,
} from '../lib/format.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, EmptyState, type Tone } from './primitives.tsx'

const BAR_TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
}

export function HostResourcesCard({ harnesses, now }: { harnesses: PanelHarness[]; now: number }) {
  const { masked } = usePeek()
  const reporting = harnesses.filter(
    (harness): harness is PanelHarness & { resources: HostResourceMetrics } =>
      harness.resources !== undefined
  )

  return (
    <CollapsibleCard
      title="Host resources"
      description="CPU, memory, and disk on the machine or container running each adapter"
      icon={<Gauge className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={reporting.length > 0 ? 'info' : 'neutral'}>{reporting.length} reporting</Badge>
      }
      defaultExpanded
    >
      <CardBody>
        {reporting.length === 0 ? (
          <EmptyState>
            Host resources appear when an adapter is online. Older adapters and adapters with
            harness access off do not report them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {reporting.map((harness) => (
              <HostResourceRow
                key={harness.harnessId}
                harness={harness}
                resources={harness.resources}
                masked={masked}
                now={now}
              />
            ))}
          </ul>
        )}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Samples describe the adapter host, not the workspaces it serves. A container shows its own
          limits and filesystem.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

function HostResourceRow({
  harness,
  resources,
  masked,
  now,
}: {
  harness: PanelHarness
  resources: HostResourceMetrics
  masked: boolean
  now: number
}) {
  const cgroup = resources.cpu.source === 'cgroup' || resources.memory.source === 'cgroup'
  const usedMemory = Math.max(0, resources.memory.totalBytes - resources.memory.freeBytes)

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <HostRowHeader
        harness={harness}
        resources={resources}
        masked={masked}
        cgroup={cgroup}
        now={now}
      />

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <UsageBar
          label="CPU"
          percent={resources.cpu.usagePercent}
          detail={`${formatPercent(resources.cpu.usagePercent)} · ${coresLabel(resources)}`}
          title={
            resources.cpu.load1 !== undefined
              ? `Load ${resources.cpu.load1} · ${resources.cpu.load5} · ${resources.cpu.load15}`
              : undefined
          }
        />
        <UsageBar
          label="Memory"
          percent={resources.memory.usedPercent}
          detail={`${formatPercent(resources.memory.usedPercent)} · ${formatBytes(usedMemory)} / ${formatBytes(resources.memory.totalBytes)}`}
          title={
            resources.memory.hostTotalBytes !== undefined
              ? `Host memory ${formatBytes(resources.memory.hostTotalBytes)}`
              : undefined
          }
        />
      </div>

      {resources.disks.length > 0 ? (
        <div className="mt-2 space-y-2">
          {resources.disks.map((disk) => (
            <DiskUsage key={`${disk.label}:${disk.path}`} disk={disk} masked={masked} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          No adapter filesystem was readable.
        </p>
      )}
    </li>
  )
}

function HostRowHeader({
  harness,
  resources,
  masked,
  cgroup,
  now,
}: {
  harness: PanelHarness
  resources: HostResourceMetrics
  masked: boolean
  cgroup: boolean
  now: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{harness.label}</span>
      <Badge tone="neutral">{harness.kind}</Badge>
      {cgroup ? <Badge tone="info">container</Badge> : null}
      <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
        {masked ? PEEK_MASK : shortId(harness.harnessId)}
      </span>
      <span
        className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400"
        title={formatTimestamp(resources.sampledAt)}
      >
        {formatRelative(resources.sampledAt, now)}
      </span>
    </div>
  )
}

function DiskUsage({ disk, masked }: { disk: HostDiskMetrics; masked: boolean }) {
  return (
    <div className="rounded-md border border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
        <span className="font-medium">{disk.label}</span>
        <span className="min-w-0 break-all font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          {masked ? PEEK_MASK : disk.path}
        </span>
        <span className="ml-auto tabular-nums text-neutral-600 dark:text-neutral-300">
          {formatPercent(disk.usedPercent)}
        </span>
      </div>
      <UsageBar
        label={`${disk.label} disk usage`}
        percent={disk.usedPercent}
        detail={`${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`}
        compact
      />
    </div>
  )
}

function UsageBar({
  label,
  percent,
  detail,
  title,
  compact = false,
}: {
  label: string
  percent?: number
  detail: string
  title?: string
  compact?: boolean
}) {
  const value = percent === undefined ? undefined : Math.min(100, Math.max(0, percent))
  return (
    <div title={title}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
        <span className="min-w-0 truncate tabular-nums text-neutral-600 dark:text-neutral-300">
          {detail}
        </span>
      </div>
      <div
        className={`${compact ? 'mt-1' : 'mt-1.5'} h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? 0}
        aria-valuetext={detail}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${BAR_TONES[usageTone(value)]}`}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function coresLabel(resources: HostResourceMetrics): string {
  const { cores, hostCores } = resources.cpu
  if (cores === hostCores) return `${cores} core${cores === 1 ? '' : 's'}`
  return `${cores} of ${hostCores} cores`
}

function usageTone(percent: number | undefined): Tone {
  if (percent === undefined) return 'neutral'
  if (percent >= 90) return 'danger'
  if (percent >= 75) return 'warning'
  return 'success'
}
