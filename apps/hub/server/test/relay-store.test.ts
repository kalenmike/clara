import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import {
  forgetRelayCredentials,
  hasRelayCredentials,
  loadRelayCredentials,
  relayCredentialsPath,
  saveRelayCredentials,
} from '../src/store/relay.ts'
import type { SecretKeyInfo } from '../src/store/secret-key.ts'
import { writeSealed } from '../src/store/sealed.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-relay-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function secretKey(): Promise<SecretKeyInfo> {
  return { key: await loadSecretKey(generateSecretKey()), version: 1, source: 'generated' }
}

describe('relay credentials', () => {
  it('round-trips a partial token pair', async () => {
    const dir = tempDir()
    const key = await secretKey()

    await saveRelayCredentials(dir, key, { clientToken: 'client-token' })
    expect(hasRelayCredentials(dir)).toBe(true)
    expect(await loadRelayCredentials(dir, key)).toEqual({ clientToken: 'client-token' })

    await saveRelayCredentials(dir, key, {
      agentToken: 'agent-token',
      clientToken: 'client-token',
    })
    expect(await loadRelayCredentials(dir, key)).toEqual({
      agentToken: 'agent-token',
      clientToken: 'client-token',
    })
  })

  it('reads a legacy full relay record as tokens only', async () => {
    const dir = tempDir()
    const key = await secretKey()
    await writeSealed(relayCredentialsPath(dir), key, 'clara:relay:credentials', {
      url: 'wss://relay.example',
      room: 'room-1',
      agentToken: 'agent-token',
      clientToken: 'client-token',
    })

    expect(await loadRelayCredentials(dir, key)).toEqual({
      agentToken: 'agent-token',
      clientToken: 'client-token',
    })
  })

  it('ignores credentials sealed with another key', async () => {
    const dir = tempDir()
    await saveRelayCredentials(dir, await secretKey(), {
      agentToken: 'agent-token',
      clientToken: 'client-token',
    })

    expect(await loadRelayCredentials(dir, await secretKey())).toBeUndefined()
  })

  it('removes the sealed file when no tokens remain', async () => {
    const dir = tempDir()
    const key = await secretKey()
    await saveRelayCredentials(dir, key, { agentToken: 'agent-token' })

    await saveRelayCredentials(dir, key, {})
    expect(hasRelayCredentials(dir)).toBe(false)

    await saveRelayCredentials(dir, key, { agentToken: 'agent-token' })
    forgetRelayCredentials(dir)
    expect(hasRelayCredentials(dir)).toBe(false)
  })
})
