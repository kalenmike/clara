import { createServer, type Server } from 'node:net'
import { describe, expect, it } from 'vitest'
import { issueAdapterPairing, type PairingMain } from '../src/adapters/pairing.ts'

function pairingMain(wsUrl: string): PairingMain {
  return async () => {
    console.log(
      JSON.stringify({
        pairing: {
          id: 'pairing-1',
          kind: 'opencode',
          label: 'OpenCode',
          transport: 'local',
          code: 'clara-harness1_code',
          wsUrl,
          room: 'local',
          fingerprint: 'fingerprint',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    )
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The probe did not bind')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function listening(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The probe did not bind')
  return { server, port: address.port }
}

describe('adapter pairing preflight', () => {
  it('fails before installing when the local hub port is closed', async () => {
    const port = await freePort()
    await expect(
      issueAdapterPairing('opencode', 'local', {
        main: pairingMain(`ws://127.0.0.1:${port}/ws`),
      })
    ).rejects.toThrow(`The hub is not answering at ws://127.0.0.1:${port}/ws`)
  })

  it('accepts a reachable local hub port', async () => {
    const { server, port } = await listening()
    try {
      const pairing = await issueAdapterPairing('opencode', 'local', {
        main: pairingMain(`ws://127.0.0.1:${port}/ws`),
      })
      expect(pairing.code).toBe('clara-harness1_code')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
