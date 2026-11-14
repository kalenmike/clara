import { describe, expect, it } from 'vitest'
import { readCgroupV2, type CgroupReader } from '../src/cgroup.ts'

const ROOT = '/sys/fs/cgroup'

function reader(files: Record<string, string>): CgroupReader {
  return async (path) => {
    const value = files[path]
    if (value === undefined) throw new Error(`ENOENT: ${path}`)
    return value
  }
}

describe('readCgroupV2', () => {
  it('reads memory and CPU limits from a cgroup v2 root', async () => {
    const snapshot = await readCgroupV2(
      reader({
        '/proc/self/cgroup': '0::/\n',
        [`${ROOT}/memory.max`]: '4294967296\n',
        [`${ROOT}/memory.current`]: '3221225472\n',
        [`${ROOT}/cpu.max`]: '200000 100000\n',
        [`${ROOT}/cpu.stat`]: 'usage_usec 12345\nuser_usec 10000\nsystem_usec 2345\n',
      })
    )

    expect(snapshot).toEqual({
      memory: { limitBytes: 4_294_967_296, usedBytes: 3_221_225_472 },
      cpu: { quotaCores: 2, usageUsec: 12_345 },
    })
  })

  it('follows the process cgroup path below the unified root', async () => {
    const paths: string[] = []
    const read: CgroupReader = async (path) => {
      paths.push(path)
      if (path === '/proc/self/cgroup') return '0::/user.slice/session-1.scope\n'
      if (path.endsWith('memory.max')) return 'max\n'
      if (path.endsWith('memory.current')) return '1024\n'
      if (path.endsWith('cpu.max')) return 'max 100000\n'
      if (path.endsWith('cpu.stat')) return 'usage_usec 42\n'
      throw new Error('ENOENT')
    }

    const snapshot = await readCgroupV2(read)
    expect(paths).toContain(`${ROOT}/user.slice/session-1.scope/memory.max`)
    expect(snapshot).toEqual({ cpu: { usageUsec: 42 } })
  })

  it('returns undefined without a cgroup v2 entry', async () => {
    const snapshot = await readCgroupV2(
      reader({
        '/proc/self/cgroup': '1:memory:/foo\n2:cpu:/bar\n',
      })
    )
    expect(snapshot).toBeUndefined()
  })

  it('ignores unlimited values and unreadable files', async () => {
    const snapshot = await readCgroupV2(
      reader({
        '/proc/self/cgroup': '0::/\n',
        [`${ROOT}/memory.max`]: 'max\n',
        [`${ROOT}/memory.current`]: '1024\n',
        [`${ROOT}/cpu.max`]: 'max 100000\n',
      })
    )
    expect(snapshot).toBeUndefined()
  })

  it('rejects a cgroup path that tries to escape the unified root', async () => {
    const snapshot = await readCgroupV2(
      reader({
        '/proc/self/cgroup': '0::/../../etc\n',
      })
    )
    expect(snapshot).toBeUndefined()
  })
})
