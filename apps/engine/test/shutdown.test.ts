import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Runtime, Store, defaultConfigPath } from '@clara/orchestration'
import { createEngineServer, type EngineServer } from '../src/server.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const config = defaultConfigPath()
if (!config) throw new Error('bundled default config is missing')
const token = 'test-token'

async function serve(): Promise<{ app: EngineServer; base: string; store: Store }> {
  const store = new Store(':memory:')
  const runtime = new Runtime({ store, configPath: config })
  const app = createEngineServer({ runtime, token, port: 0, tickMs: 60_000, workspace })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()))
  const address = app.server.address() as AddressInfo
  return { app, base: `http://127.0.0.1:${address.port}`, store }
}

describe('engine shutdown', () => {
  it('closes while an event stream is still open', async () => {
    const { app, base, store } = await serve()
    const controller = new AbortController()
    try {
      const response = await fetch(`${base}/v1/events`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('event stream has no body')
      await reader.read()

      const started = Date.now()
      await app.close()
      expect(Date.now() - started).toBeLessThan(1_000)
    } finally {
      controller.abort()
      store.db.close()
    }
  })
})
