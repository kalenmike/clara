import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OpenCode } from '@opencode/client'
import type { ModelInfo } from '@opencode/client'
import type { ModelOption } from '@clara/pipeline-preview'

const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096'

export interface OpenCodeConfig {
  url: string
  password?: string
  source: 'env' | 'service' | 'default'
  serviceFile: string
}

export interface ModelCatalog {
  ok: boolean
  reachable: boolean
  url: string
  models: ModelOption[]
  error?: string
  fetchedAt: string
}

export type ModelCatalogSource = () => Promise<ModelCatalog>

export function openCodeServiceFile(): string {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  return join(stateHome, 'opencode', 'service.json')
}

function serviceConfig(): { url: string; password?: string } | undefined {
  const path = openCodeServiceFile()
  try {
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      url?: unknown
      password?: unknown
    }
    if (typeof parsed.url !== 'string' || !parsed.url.trim()) return undefined
    return {
      url: parsed.url.trim(),
      ...(typeof parsed.password === 'string' && parsed.password
        ? { password: parsed.password }
        : {}),
    }
  } catch {
    return undefined
  }
}

export function resolveOpenCodeConfig(): OpenCodeConfig {
  const envUrl = process.env.CLARA_OPENCODE_URL?.trim()
  const envPassword = process.env.CLARA_OPENCODE_PASSWORD?.trim()
  const service = serviceConfig()
  const url = envUrl
    ? envUrl.replace(/\/+$/, '')
    : (service?.url.replace(/\/+$/, '') ?? DEFAULT_OPENCODE_URL)
  const password = envPassword || service?.password
  const source: OpenCodeConfig['source'] =
    envUrl || envPassword ? 'env' : service ? 'service' : 'default'
  return {
    url,
    ...(password ? { password } : {}),
    source,
    serviceFile: openCodeServiceFile(),
  }
}

export function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toModelOption(model: ModelInfo): ModelOption {
  return {
    providerID: model.providerID,
    id: model.modelID ?? model.id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.enabled !== undefined ? { enabled: model.enabled } : {}),
  }
}

/**
 * Load the model catalog from the OpenCode server. The lab compiles locally,
 * so a missing OpenCode server is not fatal: the caller gets an empty catalog
 * with `ok: false` and can still show static diagnostics.
 */
export function createModelCatalogLoader(
  options: { ttlMs?: number; timeoutMs?: number } = {}
): ModelCatalogSource {
  const ttlMs = options.ttlMs ?? 30_000
  const timeoutMs = options.timeoutMs ?? 1_500
  let cached: { at: number; value: ModelCatalog } | undefined

  return async () => {
    const now = Date.now()
    if (cached && now - cached.at < ttlMs) return cached.value

    const config = resolveOpenCodeConfig()
    const client = OpenCode.make({
      baseUrl: config.url,
      ...(config.password ? { headers: { authorization: basicAuth(config.password) } } : {}),
    })
    try {
      const response = await client.model.list(undefined, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      const value: ModelCatalog = {
        ok: true,
        reachable: true,
        url: config.url,
        models: response.data.map(toModelOption),
        fetchedAt: new Date(now).toISOString(),
      }
      cached = { at: now, value }
      return value
    } catch (error) {
      const value: ModelCatalog = {
        ok: false,
        reachable: false,
        url: config.url,
        models: [],
        error: errorMessage(error),
        fetchedAt: new Date(now).toISOString(),
      }
      cached = { at: now, value }
      return value
    }
  }
}
