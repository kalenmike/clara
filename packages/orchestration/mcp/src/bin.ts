#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { autostart, serviceURL, token } from './config.ts'
import { HttpBackend } from './http-backend.ts'
import { createClaraServer } from './server.ts'

async function healthy(url: string): Promise<boolean> {
  return fetch(`${url}/health`)
    .then((response) => response.ok)
    .catch(() => false)
}

function orchestratorCommand(): { command: string; args: string[] } | undefined {
  const configured = process.env.CLARA_ORCHESTRATOR_BIN?.trim()
  if (configured) return { command: process.execPath, args: [configured, 'start'] }
  const dist = fileURLToPath(new URL('../../orchestrator/dist/index.js', import.meta.url))
  if (existsSync(dist)) return { command: process.execPath, args: [dist, 'start'] }
  const source = fileURLToPath(new URL('../../orchestrator/src/index.ts', import.meta.url))
  if (existsSync(source)) {
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', source, 'start'],
    }
  }
  return
}

async function ensureService(url: string): Promise<void> {
  if (await healthy(url)) return
  if (!autostart()) throw new Error(`Clara orchestrator is not running at ${url}`)
  const command = orchestratorCommand()
  if (!command) throw new Error('Clara orchestrator is not running and no executable was found')
  console.error(`[clara-mcp] starting orchestrator at ${url}`)
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (await healthy(url)) return
  }
  throw new Error(`Clara orchestrator did not become healthy at ${url}`)
}

async function main(): Promise<void> {
  const url = serviceURL()
  await ensureService(url)
  const backend = new HttpBackend(url, token())
  const server = createClaraServer(backend)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[clara-mcp] connected to ${url}`)

  let lastAlert = 0
  const poll = setInterval(() => {
    void (async () => {
      try {
        const inbox = (await backend.inbox()) as Array<{
          id: number
          kind: string
          title: string
          body: string
        }>
        const fresh = inbox.filter((alert) => alert.id > lastAlert)
        if (!fresh.length) return
        lastAlert = Math.max(...fresh.map((alert) => alert.id))
        await server.server.sendResourceUpdated({ uri: 'clara://inbox' }).catch(() => {})
        for (const alert of fresh) {
          await server.server
            .sendLoggingMessage({
              level: alert.kind === 'stalled' ? 'warning' : 'error',
              logger: 'clara',
              data: alert,
            })
            .catch(() => {})
        }
      } catch {
        // The service may be restarting.
      }
    })()
  }, 2_000)
  poll.unref?.()

  const shutdown = async () => {
    clearInterval(poll)
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

void main().catch((error) => {
  console.error(`[clara-mcp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
