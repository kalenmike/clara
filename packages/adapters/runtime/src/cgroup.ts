import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The parts of a cgroup v2 snapshot that affect a host resource sample. */
export type CgroupSnapshot = {
  memory?: { limitBytes: number; usedBytes: number }
  cpu?: { usageUsec?: number; quotaCores?: number }
}

export type CgroupReader = (path: string) => Promise<string>

const CGROUP_ROOT = '/sys/fs/cgroup'

/**
 * Read the cgroup v2 memory and CPU limits that apply to this process. The
 * reader is injectable so tests can describe a container without touching the
 * host's cgroup tree. Returns undefined on cgroup v1, non-Linux, or when no
 * limit files are readable.
 */
export async function readCgroupV2(
  read: CgroupReader = (path) => readFile(path, 'utf8')
): Promise<CgroupSnapshot | undefined> {
  const table = await readOptional(read, '/proc/self/cgroup')
  if (table === undefined) return undefined

  const relative = cgroupV2Path(table)
  if (relative === undefined) return undefined
  const dir = join(CGROUP_ROOT, relative)

  const [memoryMax, memoryCurrent, cpuMax, cpuStat] = await Promise.all([
    readOptional(read, join(dir, 'memory.max')),
    readOptional(read, join(dir, 'memory.current')),
    readOptional(read, join(dir, 'cpu.max')),
    readOptional(read, join(dir, 'cpu.stat')),
  ])

  const snapshot: CgroupSnapshot = {}
  const limitBytes = positiveNumber(memoryMax)
  const usedBytes = numberOrUndefined(memoryCurrent)
  if (limitBytes !== undefined && usedBytes !== undefined) {
    snapshot.memory = { limitBytes, usedBytes }
  }

  const quotaCores = cpuQuotaCores(cpuMax)
  const usageUsec = cpuUsageUsec(cpuStat)
  if (quotaCores !== undefined || usageUsec !== undefined) {
    snapshot.cpu = {
      ...(quotaCores !== undefined ? { quotaCores } : {}),
      ...(usageUsec !== undefined ? { usageUsec } : {}),
    }
  }

  return snapshot.memory || snapshot.cpu ? snapshot : undefined
}

/** Extract the `0::<path>` entry from `/proc/self/cgroup`, normalized below root. */
function cgroupV2Path(table: string): string | undefined {
  for (const line of table.split('\n')) {
    const match = /^0::(.+)$/.exec(line.trim())
    if (!match) continue
    const value = match[1] ?? ''
    if (!value.startsWith('/')) return undefined
    const segments = value.split('/').filter(Boolean)
    if (segments.some((segment) => segment === '.' || segment === '..')) return undefined
    return segments.join('/')
  }
  return undefined
}

async function readOptional(read: CgroupReader, path: string): Promise<string | undefined> {
  try {
    return await read(path)
  } catch {
    return undefined
  }
}

/** `max` means "no limit" in cgroup v2; only a finite positive number counts. */
function positiveNumber(value: string | undefined): number | undefined {
  const parsed = numberOrUndefined(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (!text || text === 'max') return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** `cpu.max` is `<quota> <period>`; a `max` quota means no CPU limit. */
function cpuQuotaCores(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const [quotaText, periodText] = value.trim().split(/\s+/)
  if (quotaText === undefined || quotaText === 'max' || periodText === undefined) return undefined
  const quota = Number(quotaText)
  const period = Number(periodText)
  if (!Number.isFinite(quota) || !Number.isFinite(period) || quota <= 0 || period <= 0) {
    return undefined
  }
  return quota / period
}

/** `cpu.stat` reports cumulative microseconds in its `usage_usec` line. */
function cpuUsageUsec(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  for (const line of value.split('\n')) {
    const [name, amount] = line.trim().split(/\s+/)
    if (name !== 'usage_usec' || amount === undefined) continue
    const parsed = Number(amount)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}
