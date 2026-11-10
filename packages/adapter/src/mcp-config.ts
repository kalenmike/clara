import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readJson(path: string): JsonRecord {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

export function writeJson(path: string, value: JsonRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

export interface McpEntry {
  command: string[]
  url: string
}

export function mcpEntry(entry: string, url: string): McpEntry {
  return { command: [process.execPath, entry], url }
}

export function installOpenCodeMcp(configPath: string, entry: McpEntry): void {
  const config = readJson(configPath)
  const mcp = isRecord(config.mcp) ? config.mcp : {}
  mcp.clara = {
    type: 'local',
    command: entry.command,
    enabled: true,
    environment: { CLARA_ORCHESTRATION_URL: entry.url },
  }
  config.mcp = mcp
  writeJson(configPath, config)
}

export function removeOpenCodeMcp(configPath: string): boolean {
  if (!existsSync(configPath)) return false
  const config = readJson(configPath)
  if (!isRecord(config.mcp) || !('clara' in config.mcp)) return false
  delete config.mcp.clara
  writeJson(configPath, config)
  return true
}

export function openCodeMcpConfigured(configPath: string): boolean {
  if (!existsSync(configPath)) return false
  try {
    const config = readJson(configPath)
    return isRecord(config.mcp) && 'clara' in config.mcp
  } catch {
    return false
  }
}

export function genericMcpConfig(entry: string, url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        clara: {
          command: process.execPath,
          args: [entry],
          env: { CLARA_ORCHESTRATION_URL: url },
        },
      },
    },
    null,
    2
  )
}
