import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireRelayGrant } from '../src/cli'
import {
  REINSTALL_GRANT_MESSAGE,
  isLocalHubUrl,
  readAdapterConfig,
  writeAdapterConfig,
} from '../src/config'
import { adapterPaths } from '../src/paths'
import type { AdapterConfig } from '../src/types'

describe('adapter relay grant config', () => {
  it('needs no grant on the local transport', () => {
    expect(isLocalHubUrl('ws://127.0.0.1:8788/ws')).toBe(true)
    expect(() => requireRelayGrant('ws://127.0.0.1:8788/ws', '')).not.toThrow()
  })

  it('requires a grant on the relay transport', () => {
    expect(isLocalHubUrl('wss://relay.example/room')).toBe(false)
    expect(() => requireRelayGrant('wss://relay.example/room', undefined)).toThrow(
      REINSTALL_GRANT_MESSAGE
    )
    expect(() => requireRelayGrant('wss://relay.example/room', '')).toThrow(
      /reinstall the adapter with a new pairing code/i
    )
    expect(() => requireRelayGrant('wss://relay.example/room', 'stored-grant')).not.toThrow()
  })

  it('persists a refreshed grant with the owner-only config mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-grant-'))
    try {
      const paths = adapterPaths('opencode', {
        CLARA_ADAPTER_CONFIG_DIR: dir,
        CLARA_ADAPTER_DATA_DIR: dir,
      })
      const config: AdapterConfig<Record<string, never>> = {
        harnessId: 'harness-1',
        adapterId: 'adapter-1',
        key: 'key',
        wsUrl: 'wss://relay.example/room',
        grant: 'grant-one',
      }
      writeAdapterConfig(paths, config)
      writeAdapterConfig(paths, { ...config, grant: 'grant-two' })

      expect(readAdapterConfig(paths)?.grant).toBe('grant-two')
      if (process.platform !== 'win32') {
        expect(statSync(paths.configPath).mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
