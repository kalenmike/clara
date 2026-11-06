import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LoadedPipeline, PipelineLoadError } from '@clara/shared-types'
import { CONTENT_PIPELINE, SOFTWARE_PIPELINE } from './builtins.ts'
import { validatePipeline, type PipelineValidation } from './validate.ts'

/** Clara's config directory. Pipeline definitions live here. */
export function configDir(): string {
  const configured = process.env.CLARA_CONFIG_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara')
}

export function pipelineDir(): string {
  return join(configDir(), 'pipelines')
}

export function pipelinePath(id: string): string {
  return join(pipelineDir(), `${id}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readPipelineFile(path: string): PipelineValidation & { rawId?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { errors: [`${path}: ${(error as Error).message}`] }
  }
  const rawId = isRecord(parsed) && typeof parsed.id === 'string' ? parsed.id : undefined
  const validation = validatePipeline(parsed)
  return { ...validation, rawId }
}

/** The shipped presets, validated and labelled with their source. */
export function builtinCatalog(): {
  pipelines: LoadedPipeline[]
  errors: PipelineLoadError[]
} {
  const pipelines: LoadedPipeline[] = []
  const errors: PipelineLoadError[] = []

  for (const preset of [SOFTWARE_PIPELINE, CONTENT_PIPELINE]) {
    const builtin = validatePipeline(preset)
    if (builtin.pipeline) {
      pipelines.push({ pipeline: builtin.pipeline, source: 'builtin' })
    } else {
      errors.push({ id: preset.id, errors: builtin.errors })
    }
  }

  return { pipelines, errors }
}

export function catalogPipelines(dir: string = pipelineDir()): {
  pipelines: LoadedPipeline[]
  errors: PipelineLoadError[]
} {
  const builtins = builtinCatalog()
  const byId = new Map<string, LoadedPipeline>()
  for (const entry of builtins.pipelines) byId.set(entry.pipeline.id, entry)
  const errors = [...builtins.errors]

  if (!existsSync(dir)) return { pipelines: [...byId.values()], errors }

  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
  } catch (error) {
    errors.push({ path: dir, errors: [`${dir}: ${(error as Error).message}`] })
    return { pipelines: [...byId.values()], errors }
  }

  for (const file of files) {
    const path = join(dir, file)
    const result = readPipelineFile(path)
    if (!result.pipeline) {
      errors.push({ path, id: result.rawId, errors: result.errors })
      continue
    }
    const existing = byId.get(result.pipeline.id)
    if (existing && existing.source === 'file') {
      errors.push({
        path,
        id: result.pipeline.id,
        errors: [`${path}: duplicate pipeline id "${result.pipeline.id}"`],
      })
      continue
    }
    byId.set(result.pipeline.id, { pipeline: result.pipeline, source: 'file', path })
  }

  return { pipelines: [...byId.values()], errors }
}

export function loadPipeline(id: string, dir: string = pipelineDir()): LoadedPipeline {
  const catalog = catalogPipelines(dir)
  const found = catalog.pipelines.find((item) => item.pipeline.id === id)
  if (found) return found
  const errors = catalog.errors.filter((error) => error.id === id)
  if (errors.length) {
    throw new Error(
      `Clara: invalid pipeline "${id}": ${errors.flatMap((error) => error.errors).join('; ')}`
    )
  }
  const available = catalog.pipelines.map((item) => item.pipeline.id).join(', ')
  throw new Error(`Clara: no pipeline "${id}". Available: ${available || 'none'}`)
}
