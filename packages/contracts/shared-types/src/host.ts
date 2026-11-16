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

/** A container runtime an adapter can recognize from inside its own process. */
export type HarnessContainerRuntime = 'docker' | 'podman' | 'kubernetes' | 'other'

/** How Clara installed an adapter; recorded by the hub that issued the pairing. */
export type HarnessInstallMethod = 'local' | 'ssh' | 'docker'

/**
 * The adapter's own description of where it runs. It is a display hint, not a
 * hardware fingerprint: the hostname is the OS or container hostname, and the
 * container flag only says that the process is containerized.
 */
export type AdapterHostIdentity = {
  /** Operating system hostname, or the container hostname when containerized. */
  hostname?: string
  platform?: string
  arch?: string
  /** Present when the adapter process runs inside a container. */
  container?: {
    runtime?: HarnessContainerRuntime
  }
}

/**
 * The persisted host view exposed to the panel and web client. `installMethod`
 * comes from the pairing that enrolled the adapter, not from the adapter
 * itself, so a report cannot claim a different install path.
 */
export type HarnessHost = AdapterHostIdentity & {
  installMethod?: HarnessInstallMethod
}

/** One line that tells identical harness kinds on different hosts apart. */
export function harnessHostSummary(host: HarnessHost | undefined): string | undefined {
  if (!host) return undefined
  const hostname = host.hostname?.trim()
  const suffix =
    host.installMethod === 'ssh' ? 'SSH' : host.installMethod === 'docker' ? 'Docker' : undefined
  const name = hostname || (host.container ? 'container' : undefined)
  if (!name) return suffix
  return suffix ? `${name} · ${suffix}` : name
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
