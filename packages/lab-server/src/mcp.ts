import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolInfo } from './types.ts'

export class McpError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'McpError'
    this.code = code
  }
}

export interface ToolResult {
  value: unknown
  isError: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toolValue(result: unknown): unknown {
  if (!isRecord(result)) return null
  const structured = result.structuredContent
  if (structured && typeof structured === 'object') {
    const record = structured as Record<string, unknown>
    if (Array.isArray(record.items)) return record.items
    return record
  }
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text) as unknown
        } catch {
          return item.text
        }
      }
    }
  }
  return null
}

export class McpClient {
  private client: Client | undefined
  private connecting: Promise<void> | undefined
  readonly url: string
  readonly token: string

  constructor(url: string, token: string) {
    this.url = url
    this.token = token
  }

  get connected(): boolean {
    return Boolean(this.client)
  }

  async connect(): Promise<void> {
    if (this.client) return
    if (this.connecting) return this.connecting
    this.connecting = this.open().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private async open(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(`${this.url}/mcp`), {
      requestInit: {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      },
    })
    const client = new Client({ name: 'clara-lab', version: '0.1.0' })
    transport.onclose = () => {
      if (this.client === client) this.client = undefined
    }
    try {
      await client.connect(transport)
    } catch (error) {
      await transport.close().catch(() => {})
      throw new McpError(
        'connect_failed',
        `Could not connect to the engine at ${this.url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    this.client = client
  }

  async disconnect(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (client) await client.close().catch(() => {})
  }

  private async ready(): Promise<Client> {
    await this.connect()
    if (!this.client) throw new McpError('not_connected', 'The engine is not connected.')
    return this.client
  }

  async tools(): Promise<ToolInfo[]> {
    const client = await this.ready()
    const listed = await client.listTools()
    return listed.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    }))
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = await this.ready()
    try {
      const result = await client.callTool({ name, arguments: args })
      return {
        value: toolValue(result),
        isError: isRecord(result) && result.isError === true,
      }
    } catch {
      // A dropped Streamable HTTP session looks like a transport error. Drop
      // the client and retry once before surfacing the failure.
      await this.disconnect()
      const retry = await this.ready()
      try {
        const result = await retry.callTool({ name, arguments: args })
        return {
          value: toolValue(result),
          isError: isRecord(result) && result.isError === true,
        }
      } catch (next) {
        throw new McpError('tool_failed', next instanceof Error ? next.message : String(next))
      }
    }
  }
}
