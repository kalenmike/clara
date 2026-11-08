import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OpenCodeObserver } from '../server/opencode.ts'

const now = Date.now()

function sessionInfo(id: string, title: string, directory: string) {
  return {
    id,
    projectID: 'global',
    agent: 'build',
    model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
    cost: 0,
    tokens: { input: 0, output: 0 },
    time: { created: now - 60_000, updated: now - 1_000 },
    title,
    location: { directory },
  }
}

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', base)
    response.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/session') {
      response.end(
        JSON.stringify({
          data: [sessionInfo('ses_live', 'Fix the parser', '/workspace/clara')],
          cursor: {},
        })
      )
      return
    }
    if (url.pathname === '/api/session/active') {
      response.end(JSON.stringify({ data: { ses_live: { type: 'running' } } }))
      return
    }
    if (url.pathname === '/api/session/ses_live') {
      response.end(
        JSON.stringify({ data: sessionInfo('ses_live', 'Fix the parser', '/workspace/clara') })
      )
      return
    }
    if (url.pathname === '/api/event') {
      response.setHeader('content-type', 'text/event-stream')
      response.write(
        `data: ${JSON.stringify({
          id: 'evt_1',
          created: now,
          type: 'session.updated',
          data: { sessionID: 'ses_live' },
        })}\n\n`
      )
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('OpenCode observer', () => {
  it('merges live events with session metadata', async () => {
    const observer = new OpenCodeObserver({ url: base }, () => {})
    observer.start()
    try {
      let result = await observer.sessions()
      for (let attempt = 0; attempt < 20; attempt++) {
        if (result.sessions.some((entry) => entry.eventCount > 0)) break
        await new Promise((resolve) => setTimeout(resolve, 50))
        result = await observer.sessions()
      }
      const live = result.sessions.find((entry) => entry.id === 'ses_live')
      expect(live).toMatchObject({
        title: 'Fix the parser',
        agent: 'build',
        directory: '/workspace/clara',
        running: true,
      })
      expect(live?.eventCount).toBeGreaterThan(0)
      expect(live?.lastEventType).toBe('session.updated')
      expect(result.activeCount).toBe(1)
    } finally {
      await observer.stop()
    }
  })
})
