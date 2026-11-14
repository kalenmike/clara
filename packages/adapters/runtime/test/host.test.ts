import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { CpuInfo } from 'node:os'
import { createHostMetrics, type HostMetricsDeps } from '../src/host.ts'
import type { CgroupSnapshot } from '../src/cgroup.ts'

function cpu(user: number, idle: number): CpuInfo {
  return {
    model: 'test',
    speed: 1000,
    times: { user, nice: 0, sys: 0, idle, irq: 0 },
  }
}

type Deps = {
  setCpus: (cpus: CpuInfo[]) => void
  setCgroup: (value: CgroupSnapshot | undefined) => void
  setNow: (value: number) => void
}

function fakeDeps(overrides: Partial<HostMetricsDeps> = {}): {
  deps: HostMetricsDeps
  controls: Deps
} {
  let cpus = [cpu(0, 1_000)]
  let cgroup: CgroupSnapshot | undefined
  let now = 1_000

  const deps: HostMetricsDeps = {
    now: () => now,
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => cpus,
    totalmem: () => 16 * 1024 ** 3,
    freemem: () => 4 * 1024 ** 3,
    loadavg: () => [1.234, 0.5, 0.25],
    statfs: async () => ({ bsize: 1024, blocks: 100, bavail: 50 }),
    stat: async () => ({ dev: 1 }),
    cgroup: async () => cgroup,
    rss: () => 12_345,
    ...overrides,
  }

  return {
    deps,
    controls: {
      setCpus: (value) => {
        cpus = value
      },
      setCgroup: (value) => {
        cgroup = value
      },
      setNow: (value) => {
        now = value
      },
    },
  }
}

describe('createHostMetrics', () => {
  it('computes host CPU utilization from two samples', async () => {
    const { deps, controls } = fakeDeps()
    const metrics = createHostMetrics({ roots: [], deps })
    await metrics.refresh()

    const first = await metrics.sample()
    expect(first.cpu.usagePercent).toBeUndefined()
    expect(first.cpu.source).toBe('host')
    expect(first.cpu.load1).toBe(1.23)

    controls.setCpus([cpu(1_000, 2_000)])
    controls.setNow(3_000)
    await metrics.refresh()

    const second = await metrics.sample()
    expect(second.cpu.usagePercent).toBe(50)
    expect(second.cpu.cores).toBe(1)
    expect(second.cpu.hostCores).toBe(1)
    expect(second.memory.usedPercent).toBe(75)
    expect(second.memory.source).toBe('host')
    expect(second.sampledAt).toBe(new Date(3_000).toISOString())
  })

  it('uses cgroup v2 limits for CPU and memory', async () => {
    const { deps, controls } = fakeDeps()
    const metrics = createHostMetrics({ roots: [], deps })
    // Give the first cgroup CPU window a usage counter so the second one can
    // produce a delta.
    controls.setCgroup({
      memory: { limitBytes: 4 * 1024 ** 3, usedBytes: 3 * 1024 ** 3 },
      cpu: { quotaCores: 2, usageUsec: 0 },
    })
    await metrics.refresh()

    controls.setNow(3_000)
    controls.setCgroup({
      memory: { limitBytes: 4 * 1024 ** 3, usedBytes: 3 * 1024 ** 3 },
      cpu: { quotaCores: 2, usageUsec: 1_000_000 },
    })
    await metrics.refresh()

    const sample = await metrics.sample()
    expect(sample.cpu.source).toBe('cgroup')
    expect(sample.cpu.cores).toBe(2)
    expect(sample.cpu.hostCores).toBe(1)
    expect(sample.cpu.usagePercent).toBe(25)
    expect(sample.cpu.load1).toBeUndefined()
    expect(sample.memory.source).toBe('cgroup')
    expect(sample.memory.totalBytes).toBe(4 * 1024 ** 3)
    expect(sample.memory.freeBytes).toBe(1 * 1024 ** 3)
    expect(sample.memory.hostTotalBytes).toBe(16 * 1024 ** 3)
    expect(sample.memory.processRssBytes).toBe(12_345)
  })

  it('dedupes adapter roots that share a filesystem device', async () => {
    const devices = new Map([
      ['/data', 1],
      ['/config', 1],
    ])
    const { deps } = fakeDeps({
      stat: async (path) => ({ dev: devices.get(path) ?? 1 }),
    })
    const metrics = createHostMetrics({
      roots: [
        { label: 'Adapter data', path: '/data' },
        { label: 'Adapter config', path: '/config' },
      ],
      deps,
    })
    await metrics.refresh()

    const sample = await metrics.sample()
    expect(sample.disks).toEqual([
      {
        label: 'Adapter data',
        path: '/data',
        totalBytes: 102_400,
        freeBytes: 51_200,
        usedPercent: 50,
      },
    ])
  })

  it('reports separate filesystems and skips the ones it cannot read', async () => {
    const devices = new Map([
      ['/data', 1],
      ['/config', 2],
    ])
    const { deps } = fakeDeps({
      stat: async (path) => ({ dev: devices.get(path) ?? 1 }),
      statfs: async (path) => {
        if (path === '/config') throw new Error('ENOENT')
        return { bsize: 1024, blocks: 100, bavail: 20 }
      },
    })
    const metrics = createHostMetrics({
      roots: [
        { label: 'Adapter data', path: '/data' },
        { label: 'Adapter config', path: '/config' },
        { label: 'Adapter missing', path: '/missing' },
      ],
      deps,
    })
    await metrics.refresh()

    const sample = await metrics.sample()
    expect(sample.disks).toHaveLength(1)
    expect(sample.disks[0]?.path).toBe('/data')
    expect(sample.disks[0]?.usedPercent).toBe(80)
  })

  it('serves the sample over the harness route', async () => {
    const { deps } = fakeDeps()
    const metrics = createHostMetrics({ roots: [], deps })
    await metrics.refresh()

    const parent = new Hono()
    parent.get('/harness/v1/info', (c) => c.json({ ok: true }))
    parent.route('/', metrics.routes)

    const info = await parent.request('/harness/v1/info')
    expect(info.status).toBe(200)

    const response = await parent.request('/harness/v1/host')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as {
      platform: string
      arch: string
      cpu: { source: string }
      memory: { processRssBytes: number }
      disks: unknown[]
    }
    expect(body.platform).toBe('linux')
    expect(body.arch).toBe('x64')
    expect(body.cpu.source).toBe('host')
    expect(body.memory.processRssBytes).toBe(12_345)
    expect(body.disks).toEqual([])
  })
})
