/** Where a host resource measurement came from. */
export type HostResourceSource = 'host' | 'cgroup'

export type HostCpuMetrics = {
  /** Effective cores: the cgroup quota when one exists, otherwise host cores. */
  cores: number
  /** Logical cores the adapter machine exposes, regardless of a cgroup quota. */
  hostCores: number
  /** Utilization of the effective cores over the last sampling window. */
  usagePercent?: number
  source: HostResourceSource
  /** Unix host load averages; absent on Windows and when cgroup-scoped. */
  load1?: number
  load5?: number
  load15?: number
}

export type HostMemoryMetrics = {
  /** Effective memory limit, or host memory when no cgroup limit applies. */
  totalBytes: number
  freeBytes: number
  usedPercent: number
  source: HostResourceSource
  /** Host memory when a cgroup limit narrows the effective total. */
  hostTotalBytes?: number
  /** Resident memory of the adapter process itself. */
  processRssBytes?: number
}

export type HostDiskMetrics = {
  /** Which adapter directory the filesystem serves. */
  label: string
  path: string
  totalBytes: number
  freeBytes: number
  usedPercent: number
}

/** A live resource sample from the machine, or container, running an adapter. */
export type HostResourceMetrics = {
  sampledAt: string
  platform: string
  arch: string
  cpu: HostCpuMetrics
  memory: HostMemoryMetrics
  disks: HostDiskMetrics[]
}
