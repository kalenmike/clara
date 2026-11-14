import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ClaraAgentListOutput,
  ClaraCommandListOutput,
  ClaraModel,
  ClaraModelListOutput,
  ClaraProviderListOutput,
  ClaraReferenceListOutput,
  ClaraSkill,
  ClaraSkillListOutput,
} from '@clara/api-contract'
import { AdapterError } from '@clara/adapter-runtime'
import type { PiConfig } from './config.ts'
import { piProcessEnv } from './discover.ts'
import { PiRpcClient, type PiModel } from './pi/client.ts'

const CATALOG_TIMEOUT_MS = 60_000
const DEFAULT_CATALOG_SECONDS = 30
const MAX_SKILL_BYTES = 512 * 1024

type PiCommand = {
  name: string
  description?: string
  source?: string
  sourceInfo?: {
    path?: string
    scope?: string
    origin?: string
  }
}

export type PiCatalog = {
  models: PiModel[]
  commands: PiCommand[]
}

/**
 * Pi loads extensions, skills, and prompt templates per process, so the
 * catalog comes from a short-lived RPC child and is cached per directory.
 */
export class CatalogService {
  private readonly config: PiConfig
  private readonly binary: string
  private readonly cache = new Map<string, { at: number; value: PiCatalog }>()
  private readonly loading = new Map<string, Promise<PiCatalog>>()

  constructor(config: PiConfig, binary: string) {
    this.config = config
    this.binary = binary
  }

  agents(directory: string): ClaraAgentListOutput {
    return { location: { directory }, data: [] }
  }

  async models(directory: string, location?: string): Promise<ClaraModelListOutput> {
    const catalog = await this.load(directory)
    return {
      location: { directory: location ?? directory },
      data: catalog.models.map(toClaraModel),
    }
  }

  async providers(directory: string, location?: string): Promise<ClaraProviderListOutput> {
    const catalog = await this.load(directory)
    const seen = new Map<string, string>()
    for (const model of catalog.models) {
      if (!seen.has(model.provider)) seen.set(model.provider, labelFor(model.provider))
    }
    return {
      location: { directory: location ?? directory },
      data: [...seen.entries()].map(([id, name]) => ({
        id,
        name,
        activation: 'enabled',
        package: 'pi',
      })),
    }
  }

  async commands(directory: string, location?: string): Promise<ClaraCommandListOutput> {
    const catalog = await this.load(directory)
    return {
      location: { directory: location ?? directory },
      data: catalog.commands
        .filter((command) => command.source !== 'skill')
        .map((command) => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
        })),
    }
  }

  async skills(directory: string, location?: string): Promise<ClaraSkillListOutput> {
    const catalog = await this.load(directory)
    const data: ClaraSkill[] = []
    for (const command of catalog.commands) {
      if (command.source !== 'skill' || !command.name.startsWith('skill:')) continue
      const skill = readSkill(command)
      if (skill) data.push(skill)
    }
    return { location: { directory: location ?? directory }, data }
  }

  references(directory: string): ClaraReferenceListOutput {
    return { location: { directory }, data: [] }
  }

  invalidate(): void {
    this.cache.clear()
  }

  private async load(directory: string): Promise<PiCatalog> {
    const cwd =
      existsSync(directory) && statSync(directory).isDirectory() ? directory : process.cwd()
    const cached = this.cache.get(cwd)
    const ttl = Math.max(1, this.config.catalogCacheSeconds ?? DEFAULT_CATALOG_SECONDS) * 1_000
    if (cached && Date.now() - cached.at < ttl) return cached.value
    const pending = this.loading.get(cwd)
    if (pending) return pending
    const promise = this.fetch(cwd).finally(() => this.loading.delete(cwd))
    this.loading.set(cwd, promise)
    return promise
  }

  private async fetch(cwd: string): Promise<PiCatalog> {
    let client: PiRpcClient
    try {
      client = await PiRpcClient.start({
        binary: this.binary,
        cwd,
        env: piProcessEnv(this.config),
        noSession: true,
        requestTimeoutMs: CATALOG_TIMEOUT_MS,
        trust: this.config.trust ?? 'inherit',
      })
    } catch (cause) {
      throw new AdapterError(
        502,
        'harness_offline',
        `Pi could not start: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
    try {
      const [commands, models] = await Promise.all([
        client.request<{ commands?: PiCommand[] }>({ type: 'get_commands' }),
        client.request<{ models?: PiModel[] }>({ type: 'get_available_models' }),
      ])
      const value: PiCatalog = {
        commands: Array.isArray(commands?.commands) ? commands.commands : [],
        models: Array.isArray(models?.models) ? models.models : [],
      }
      this.cache.set(cwd, { at: Date.now(), value })
      return value
    } catch (cause) {
      const fallback = cachedFallback(this.cache, cwd)
      if (fallback) return fallback
      throw new AdapterError(
        502,
        'harness_offline',
        `Pi could not list commands and models: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    } finally {
      await client.close(2_000)
    }
  }
}

function cachedFallback(
  cache: Map<string, { at: number; value: PiCatalog }>,
  cwd: string
): PiCatalog | undefined {
  return cache.get(cwd)?.value
}

function toClaraModel(model: PiModel): ClaraModel {
  return {
    id: model.id,
    modelID: model.id,
    providerID: model.provider,
    canonical: model.id,
    name: model.name,
    capabilities: {
      tools: true,
      input: Array.isArray(model.input) && model.input.length > 0 ? model.input : ['text'],
      output: ['text'],
    },
    variants: [],
    time: { released: 0 },
    cost: model.cost
      ? [
          {
            input: model.cost.input,
            output: model.cost.output,
            cache: { read: model.cost.cacheRead, write: model.cost.cacheWrite },
          },
        ]
      : [],
    status: 'active',
    enabled: true,
    limit: {
      context: model.contextWindow ?? 200_000,
      output: model.maxTokens ?? 64_000,
    },
  }
}

function readSkill(command: PiCommand): ClaraSkill | undefined {
  const name = command.name.replace(/^skill:/, '')
  const path = command.sourceInfo?.path
  if (!path) {
    return {
      id: command.name,
      name,
      path: '',
      content: command.description ?? '',
      ...(command.description ? { description: command.description } : {}),
    }
  }
  const file = skillFile(path)
  let content = command.description ?? ''
  let autoinvoke = true
  try {
    if (file) {
      const stats = statSync(file)
      if (stats.size <= MAX_SKILL_BYTES) {
        content = readFileSync(file, 'utf8')
        autoinvoke = !/disable-model-invocation:\s*true/i.test(content.slice(0, 2_000))
      } else {
        content = content.slice(0, MAX_SKILL_BYTES)
      }
    }
  } catch {
    // Keep the description when the skill file cannot be read.
  }
  return {
    id: command.name,
    name,
    ...(command.description ? { description: command.description } : {}),
    autoinvoke,
    path: file ?? path,
    content,
  }
}

function skillFile(path: string): string | undefined {
  if (path.endsWith('.md')) return path
  const candidate = join(path, 'SKILL.md')
  return existsSync(candidate) ? candidate : undefined
}

function labelFor(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
