import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adapterPaths } from '../src/paths'
import { clearAdapterPid, writeAdapterPid } from '../src/service'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-service-'))
  roots.push(root)
  return adapterPaths('opencode', {
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
  })
}

describe('adapter pid ownership', () => {
  it('clears the pid file only for the process that wrote it', () => {
    const adapter = paths()
    writeAdapterPid(adapter, 4242)
    expect(existsSync(adapter.pidPath)).toBe(true)

    clearAdapterPid(adapter, 5252)
    expect(existsSync(adapter.pidPath)).toBe(true)

    clearAdapterPid(adapter, 4242)
    expect(existsSync(adapter.pidPath)).toBe(false)
  })
})
