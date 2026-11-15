import { randomBytes } from 'node:crypto'
import { startHostServer } from './server.ts'

/**
 * CLI entry for the Tauri sidecar. The shell passes `--token` (and optionally
 * `--port`); the first stdout line tells it which loopback port was bound.
 */
async function main(): Promise<void> {
  const token = argValue('--token') ?? randomBytes(32).toString('hex')
  const port = parsePort(argValue('--port'))

  const server = await startHostServer({
    token,
    ...(port !== undefined ? { port } : {}),
    log: (message, detail) => {
      const suffix = detail instanceof Error ? `: ${detail.message}` : ''
      process.stderr.write(`clara-adapter-host: ${message}${suffix}\n`)
    },
  })

  process.stdout.write(`CLARA_ADAPTER_HOST ${JSON.stringify({ port: portOf(server.baseUrl) })}\n`)
  process.stdout.write(`clara-adapter-host listening on ${server.baseUrl}\n`)

  const shutdown = () => {
    void server.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.stdin.on('end', shutdown)
  process.stdin.resume()
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : undefined
}

function portOf(baseUrl: string): number {
  return Number.parseInt(new URL(baseUrl).port, 10)
}

main().catch((cause) => {
  process.stderr.write(
    `clara-adapter-host: ${cause instanceof Error ? cause.message : String(cause)}\n`
  )
  process.exit(1)
})
