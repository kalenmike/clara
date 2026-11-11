#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClaraApiServer } from '@clara/api-mcp'
import { HttpBackend } from './backend.ts'
import { apiToken, apiURL } from './config.ts'

async function main(): Promise<void> {
  const url = apiURL()
  const token = apiToken()
  if (!token) {
    console.error(
      '[clara-api-mcp] no API token found. Set CLARA_API_TOKEN or CLARA_API_TOKEN_FILE, ' +
        'or start the hub so it can generate one.'
    )
    process.exit(1)
  }

  const server = createClaraApiServer(new HttpBackend(url, token))
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[clara-api-mcp] connected to ${url}`)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

void main().catch((error) => {
  console.error(`[clara-api-mcp] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
