import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

type Fixture = {
  dir: string
  child: ChildProcess
  stderr: () => string
}

const fixtures: Fixture[] = []
const servers: WebSocketServer[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.child.kill('SIGKILL')
    rmSync(fixture.dir, { recursive: true, force: true })
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) client.terminate()
          server.close(() => resolve())
        })
    )
  )
})

describe('adapter process lifetime', () => {
  it('stays running and reconnects after the hub closes the socket', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo

    let connections = 0
    server.on('connection', (socket) => {
      connections += 1
      // Act like a hub restart: every connection is closed after the upgrade.
      setTimeout(() => socket.close(1001, 'hub restarting'), 100)
    })

    const fixture = startFixture(address.port)
    fixtures.push(fixture)

    // A disconnected adapter must keep the process alive long enough to retry.
    // Before the fix the child exited 0 on the first close and never reconnected.
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && connections < 2 && !stopped(fixture.child)) {
      await sleep(50)
    }

    expect(stopped(fixture.child), `adapter process exited\n${fixture.stderr()}`).toBe(false)
    expect(connections).toBeGreaterThanOrEqual(2)
  }, 20_000)
})

function startFixture(port: number): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-serve-'))
  const entry = fileURLToPath(new URL('./fixtures/serve.ts', import.meta.url))
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', entry, `ws://127.0.0.1:${port}`],
    {
      env: { ...process.env, CLARA_TEST_DIR: dir },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  return { dir, child, stderr: () => stderr }
}

function stopped(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
