import { statfs, stat } from 'node:fs/promises'
import {
  arch as osArch,
  cpus as osCpus,
  freemem as osFreemem,
  loadavg as osLoadavg,
  platform as osPlatform,
  totalmem as osTotalmem,
  type CpuInfo,
} from 'node:os'
import { Hono } from 'hono'
import type {
  HostCpuMetrics,
  HostDiskMetrics,
  HostMemoryMetrics,
  HostResourceMetrics,
} from '@clara/shared-types'
import { readCgroupV2, type CgroupSnapshot } from './cgroup.ts'

/** One directory whose filesystem is relevant to the adapter. */
export type HostRoot = {
  label: string
  path: string
}

/** The filesystem numbers the sample needs; narrowed for test fakes. */
export type StatFsInfo = {
  bsize: number
  blocks: number
  bavail: number
}

export type HostMetricsDeps = {
  now: () => number
  platform: () => string
  arch: () => string
  cpus: () => CpuInfo[]
  totalmem: () => number
  freemem: () => number
  loadavg: () => number[]
  statfs: (path: string) => Promise<StatFsInfo>
  stat: (path: string) => Promise<{ dev: number | bigint }>
  cgroup: () => Promise<CgroupSnapshot | undefined>
  rss: () => number
}

export type HostMetricsOptions = {
  roots: HostRoot[]
  intervalMs?: number
  deps?: Partial<HostMetricsDeps>
}

export type HostMetrics = {
  routes: Hono
  start: () => void
  stop: () => void
  sample: () => Promise<HostResourceMetrics>
  /** Take one sample immediately; used by tests and by `start`. */
  refresh: () => Promise<void>
}

type CpuWindow = { idle: number; total: number }
type CgroupCpuWindow = { at: number; usageUsec: number }
type LatestSample = {
  at: number
  cpu: HostCpuMetrics
  memory: Omit<HostMemoryMetrics, 'processRssBytes'>
}

const DEFAULT_INTERVAL_MS = 2_000
const MIN_INTERVAL_MS = 500

const defaults: HostMetricsDeps = {
  now: Date.now,
  platform: () => osPlatform(),
  arch: () => osArch(),
  cpus: () => osCpus(),
  totalmem: () => osTotalmem(),
  freemem: () => osFreemem(),
  loadavg: () => osLoadavg(),
  statfs: async (path) => {
    const value = await statfs(path)
    return { bsize: value.bsize, blocks: value.blocks, bavail: value.bavail }
  },
  stat: async (path) => ({ dev: (await stat(path)).dev }),
  cgroup: () => readCgroupV2(),
  rss: () => process.memoryUsage().rss,
}

/**
 * Collects the adapter machine's CPU, memory, and disk numbers. CPU needs a
 * delta between samples, so `start` keeps a two-second window in the adapter
 * process; the endpoint itself only reads the latest values.
 */
export function createHostMetrics(options: HostMetricsOptions): HostMetrics {
  const deps: HostMetricsDeps = { ...defaults, ...options.deps }
  const roots = options.roots.filter((root) => root.path.length > 0)
  const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  const app = new Hono()

  let latest: LatestSample | undefined
  let previousHostCpu: CpuWindow | undefined
  let previousCgroupCpu: CgroupCpuWindow | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let refreshing: Promise<void> | undefined

  const refresh = (): Promise<void> => {
    if (refreshing) return refreshing
    refreshing = doRefresh().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }

  async function doRefresh(): Promise<void> {
    const at = deps.now()
    let cgroup: CgroupSnapshot | undefined
    try {
      cgroup = await deps.cgroup()
    } catch {
      cgroup = undefined
    }

    const cpu = readCpu(cgroup, at)
    const memory = readMemory(cgroup)
    latest = { at, cpu, memory }
  }

  function readCpu(cgroup: CgroupSnapshot | undefined, at: number): HostCpuMetrics {
    const cpus = deps.cpus()
    const hostCores = Math.max(1, cpus.length)
    const host = readHostCpu(cpus)
    const quotaCores = cgroup?.cpu?.quotaCores
    const cgroupUsage = cgroup?.cpu?.usageUsec

    if (quotaCores !== undefined && cgroupUsage !== undefined) {
      const previous = previousCgroupCpu
      previousCgroupCpu = { at, usageUsec: cgroupUsage }
      previousHostCpu = undefined
      const elapsedMs = previous ? at - previous.at : 0
      const usedMs = previous ? Math.max(0, (cgroupUsage - previous.usageUsec) / 1_000) : 0
      return {
        cores: round(quotaCores, 2),
        hostCores,
        source: 'cgroup',
        ...(previous && elapsedMs > 0
          ? { usagePercent: round(clamp((usedMs / (elapsedMs * quotaCores)) * 100, 0, 100), 1) }
          : {}),
      }
    }

    const previous = previousHostCpu
    previousHostCpu = host
    previousCgroupCpu = undefined
    const totalDelta = previous ? host.total - previous.total : 0
    const idleDelta = previous ? host.idle - previous.idle : 0
    const usagePercent =
      previous && totalDelta > 0 ? clamp((1 - idleDelta / totalDelta) * 100, 0, 100) : undefined
    const loads = deps.platform() === 'win32' ? undefined : deps.loadavg()

    return {
      cores: hostCores,
      hostCores,
      source: 'host',
      ...(usagePercent !== undefined ? { usagePercent: round(usagePercent, 1) } : {}),
      ...(loads
        ? {
            load1: round(loads[0] ?? 0, 2),
            load5: round(loads[1] ?? 0, 2),
            load15: round(loads[2] ?? 0, 2),
          }
        : {}),
    }
  }

  function readMemory(cgroup: CgroupSnapshot | undefined): Omit<HostMemoryMetrics, 'processRssBytes'> {
    const hostTotal = deps.totalmem()
    const hostFree = deps.freemem()
    const limited = cgroup?.memory
    if (limited && limited.limitBytes > 0) {
      const free = Math.max(0, limited.limitBytes - limited.usedBytes)
      return {
        totalBytes: limited.limitBytes,
        freeBytes: free,
        usedPercent: percentUsed(free, limited.limitBytes),
        source: 'cgroup',
        hostTotalBytes: hostTotal,
      }
    }
    return {
      totalBytes: hostTotal,
      freeBytes: hostFree,
      usedPercent: percentUsed(hostFree, hostTotal),
      source: 'host',
    }
  }

  async function readDisks(): Promise<HostDiskMetrics[]> {
    const disks: HostDiskMetrics[] = []
    const seen = new Set<string>()
    for (const root of roots) {
      try {
        const info = await deps.stat(root.path)
        const device = String(info.dev)
        if (seen.has(device)) continue
        const value = await deps.statfs(root.path)
        const total = value.blocks * value.bsize
        if (!Number.isFinite(total) || total <= 0) continue
        const free = clamp(value.bavail * value.bsize, 0, total)
        disks.push({
          label: root.label,
          path: root.path,
          totalBytes: total,
          freeBytes: free,
          usedPercent: percentUsed(free, total),
        })
        seen.add(device)
      } catch {
        // A missing directory or an unsupported filesystem must not hide the
        // rest of the sample.
      }
    }
    return disks
  }

  async function sample(): Promise<HostResourceMetrics> {
    if (!latest) await refresh()
    const current = latest
    const disks = await readDisks()
    return {
      sampledAt: new Date(current?.at ?? deps.now()).toISOString(),
      platform: deps.platform(),
      arch: deps.arch(),
      cpu: current?.cpu ?? { cores: 1, hostCores: 1, source: 'host' },
      memory: {
        ...(current?.memory ?? {
          totalBytes: 0,
          freeBytes: 0,
          usedPercent: 0,
          source: 'host' as const,
        }),
        processRssBytes: deps.rss(),
      },
      disks,
    }
  }

  app.get('/harness/v1/host', async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await sample())
  })

  return {
    routes: app,
    start: () => {
      if (timer) return
      void refresh()
      timer = setInterval(() => {
        void refresh()
      }, intervalMs)
      timer.unref?.()
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
    },
    sample,
    refresh,
  }
}

function readHostCpu(cpus: CpuInfo[]): CpuWindow {
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function percentUsed(freeBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  return round(clamp(((totalBytes - freeBytes) / totalBytes) * 100, 0, 100), 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
