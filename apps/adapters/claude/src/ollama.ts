import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaraModel } from '@clara/api-contract'
import type { ClaudeConfig } from './config.ts'

const DEFAULT_CONTEXT = 8_192
const DEFAULT_OUTPUT = 4_096
const CUSTOM_CONTEXT = 200_000
const CUSTOM_OUTPUT = 64_000
const PROBE_TIMEOUT_MS = 1_500

const CLAUDE_ALIASES = new Set(['default', 'opus', 'fable', 'sonnet', 'haiku'])

export type ClaudeEndpoint = {
  baseUrl?: string
  authToken?: string
  model?: string
}

export type OllamaTag = {
  name: string
  details?: {
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
    context_length?: number
    embedding_length?: number
  }
  capabilities?: string[]
}

export type OllamaDiscovery = {
  baseUrl: string
  models: OllamaTag[]
}

export type OllamaCustomRow = {
  value: string
  name: string
  description?: string
  resolvedModel?: string
}

export type OllamaModelRow = {
  value: string
  name: string
  description?: string
  resolvedModel?: string
  family?: string
  capabilities: ClaraModel['capabilities']
  limit: ClaraModel['limit']
  cost: ClaraModel['cost']
  status: ClaraModel['status']
  enabled: boolean
}

/**
 * Resolve the endpoint Claude Code is talking to. An explicit adapter setting
 * wins, then the adapter process environment, then the user's Claude settings.
 */
export function claudeEndpoint(
  config: Pick<ClaudeConfig, 'baseUrl' | 'model'>,
  env: NodeJS.ProcessEnv = process.env
): ClaudeEndpoint {
  const settings = settingsEnvironment(env)
  const baseUrl = firstString(config.baseUrl, env.ANTHROPIC_BASE_URL, settings.ANTHROPIC_BASE_URL)
  const authToken = firstString(
    env.ANTHROPIC_AUTH_TOKEN,
    settings.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
    settings.ANTHROPIC_API_KEY
  )
  const model = firstString(config.model, env.ANTHROPIC_MODEL, settings.ANTHROPIC_MODEL)
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(authToken ? { authToken } : {}),
    ...(model ? { model } : {}),
  }
}

/** Read the env block from the Claude Code user settings. */
export function settingsEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const directory = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  let settings: unknown
  try {
    settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
  if (!isRecord(settings) || !isRecord(settings.env)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(settings.env)) {
    if (typeof value === 'string' && value.trim()) result[key] = value.trim()
  }
  return result
}

/**
 * Ollama serves its model list at /api/tags. Try the URL origin first because
 * ANTHROPIC_BASE_URL often ends in /v1, then the path-relative form for a
 * base URL with a prefix.
 */
export function ollamaTagsUrls(baseUrl: string): string[] {
  const trimmed = baseUrl.trim()
  if (!trimmed) return []
  try {
    const url = new URL(trimmed)
    const candidateBases = [
      trimmed.endsWith('/') ? trimmed : `${trimmed}/`,
      `${trimmed.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/`,
    ]
    const urls = [
      new URL('/api/tags', url.origin).toString(),
      ...candidateBases.map((base) => new URL('api/tags', base).toString()),
    ]
    return [...new Set(urls)]
  } catch {
    return []
  }
}

/**
 * Discover the models installed on an Ollama server. Returns undefined when the
 * endpoint is not Ollama or is unreachable, so callers can fall back to the
 * models Claude Code reports itself.
 */
export async function discoverOllama(
  baseUrl: string | undefined,
  options: {
    authToken?: string
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {}
): Promise<OllamaDiscovery | undefined> {
  if (!baseUrl?.trim()) return undefined
  const urls = ollamaTagsUrls(baseUrl)
  if (urls.length === 0) return undefined
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    for (const url of urls) {
      if (abort.signal.aborted) break
      try {
        const response = await fetchImpl(url, {
          signal: abort.signal,
          headers: {
            accept: 'application/json',
            ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}),
          },
        })
        if (!response.ok) continue
        const body: unknown = await response.json()
        if (!isRecord(body) || !Array.isArray(body.models)) continue
        return {
          baseUrl: new URL(baseUrl).origin,
          models: body.models.filter(isOllamaTag).map(normalizeTag),
        }
      } catch {
        // Try the next candidate URL.
      }
    }
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Rows that came from Claude Code but are not one of its built-in models. */
export function isCustomClaudeModel(row: { value: string; resolvedModel?: string }): boolean {
  if (CLAUDE_ALIASES.has(row.value)) return false
  return !(row.resolvedModel ?? row.value).startsWith('claude-')
}

/**
 * Build Clara model rows from Ollama tags. Custom rows that point at a tag keep
 * their own label; custom rows the server does not know are kept as well.
 */
export function ollamaModels(tags: OllamaTag[], custom: OllamaCustomRow[] = []): OllamaModelRow[] {
  const byName = new Map<string, OllamaCustomRow>()
  for (const row of custom) {
    byName.set(row.value, row)
    if (row.resolvedModel) byName.set(row.resolvedModel, row)
  }
  const names = new Set(tags.map((tag) => tag.name))
  const models = tags.map((tag) => ollamaModel(tag, byName.get(tag.name)))
  for (const row of custom) {
    if (names.has(row.value)) continue
    if (row.resolvedModel && names.has(row.resolvedModel)) continue
    models.push(customModel(row))
  }
  return models
}

/** Prefer the configured model when the server has it, otherwise a tool model. */
export function ollamaDefaultModel(tags: OllamaTag[], preferred?: string): string | undefined {
  const wanted = preferred?.trim()
  if (wanted && tags.some((tag) => tag.name === wanted)) return wanted
  const toolModel = tags.find((tag) =>
    tag.capabilities ? tag.capabilities.includes('tools') : true
  )
  return (toolModel ?? tags[0])?.name
}

function ollamaModel(tag: OllamaTag, custom: OllamaCustomRow | undefined): OllamaModelRow {
  const capabilities = new Set(tag.capabilities ?? [])
  const input = ['text']
  if (capabilities.has('vision')) input.push('image')
  if (capabilities.has('audio')) input.push('audio')
  const context = positive(tag.details?.context_length) ?? DEFAULT_CONTEXT
  return {
    value: tag.name,
    name: custom?.name?.trim() || tag.name,
    ...(custom?.description ? { description: custom.description } : {}),
    resolvedModel: tag.name,
    ...(tag.details?.family ? { family: tag.details.family } : {}),
    capabilities: {
      tools: tag.capabilities ? capabilities.has('tools') : true,
      input,
      output: ['text'],
      temperature: true,
    },
    limit: { context, output: Math.min(DEFAULT_OUTPUT, context) },
    cost: [],
    status: 'active',
    enabled: true,
  }
}

function customModel(row: OllamaCustomRow): OllamaModelRow {
  return {
    value: row.value,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.resolvedModel ? { resolvedModel: row.resolvedModel } : {}),
    capabilities: {
      tools: true,
      input: ['text', 'image'],
      output: ['text'],
      temperature: false,
    },
    limit: { context: CUSTOM_CONTEXT, output: CUSTOM_OUTPUT },
    cost: [],
    status: 'active',
    enabled: true,
  }
}

function normalizeTag(value: Record<string, unknown>): OllamaTag {
  const details = isRecord(value.details) ? value.details : undefined
  return {
    name: String(value.name ?? value.model ?? '').trim(),
    ...(details
      ? {
          details: {
            ...(typeof details.family === 'string' ? { family: details.family } : {}),
            ...(Array.isArray(details.families)
              ? {
                  families: details.families.filter(
                    (item): item is string => typeof item === 'string'
                  ),
                }
              : {}),
            ...(typeof details.parameter_size === 'string'
              ? { parameter_size: details.parameter_size }
              : {}),
            ...(typeof details.quantization_level === 'string'
              ? { quantization_level: details.quantization_level }
              : {}),
            ...(positive(details.context_length) !== undefined
              ? { context_length: positive(details.context_length) }
              : {}),
            ...(positive(details.embedding_length) !== undefined
              ? { embedding_length: positive(details.embedding_length) }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(value.capabilities)
      ? {
          capabilities: value.capabilities.filter(
            (item): item is string => typeof item === 'string'
          ),
        }
      : {}),
  }
}

function isOllamaTag(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const name = value.name ?? value.model
  return typeof name === 'string' && name.trim().length > 0
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
