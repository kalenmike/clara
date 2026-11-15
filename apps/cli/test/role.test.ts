import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveAdapterRecord } from '../src/adapters/state.ts'
import { resolvePaths } from '../src/paths.ts'
import { detectRole, resolveRole, roleLabel } from '../src/state/role.ts'

const dirs: string[] = []

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'clara-role-'))
  dirs.push(root)
  return resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('CLI role', () => {
  it('prefers a hub configuration over paired adapters', () => {
    expect(resolveRole({ hasHubConfig: true, hasStackState: false, pairedAdapters: 2 })).toBe('hub')
    expect(resolveRole({ hasHubConfig: false, hasStackState: true, pairedAdapters: 2 })).toBe('hub')
    expect(resolveRole({ hasHubConfig: false, hasStackState: false, pairedAdapters: 1 })).toBe(
      'adapter'
    )
    expect(resolveRole({ hasHubConfig: false, hasStackState: false, pairedAdapters: 0 })).toBe(
      'unconfigured'
    )
  })

  it('labels each role for humans', () => {
    expect(roleLabel('hub')).toBe('hub host')
    expect(roleLabel('adapter')).toBe('adapter host')
    expect(roleLabel('unconfigured')).toBe('unconfigured')
  })

  it('detects an adapter host without a local hub config', () => {
    const local = paths()
    expect(detectRole(local)).toBe('unconfigured')
    saveAdapterRecord(
      {
        kind: 'opencode',
        version: '0.1.0',
        platform: 'linux-x64',
        path: '/tmp/opencode',
        installedAt: new Date().toISOString(),
        pairedAt: new Date().toISOString(),
      },
      local
    )
    expect(detectRole(local)).toBe('adapter')
  })

  it('treats a hub config or stack state as a hub host', () => {
    const configured = paths()
    mkdirSync(configured.configDir, { recursive: true })
    writeFileSync(join(configured.configDir, 'server.json'), '{}')
    expect(detectRole(configured)).toBe('hub')

    const running = paths()
    mkdirSync(running.dataDir, { recursive: true })
    writeFileSync(running.stateFile, '{}')
    expect(detectRole(running)).toBe('hub')
  })
})
