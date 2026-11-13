import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type RelayArtifact = {
  code: string
  scriptName: string
  mainModule: string
  compatibilityDate: string
  migrationTag: string
  durableObject: {
    binding: string
    className: string
  }
}

const ARTIFACT_DIR_ENV = 'CLARA_RELAY_ARTIFACT_DIR'

export function loadRelayArtifact(): RelayArtifact {
  const dir = resolveArtifactDir()
  if (!dir) {
    throw new Error(
      'The relay worker bundle is missing. Rebuild the hub service with ENABLE_CLOUDFLARE_DEPLOYMENT=true.'
    )
  }

  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown
  if (!isRecord(manifest) || !isRecord(manifest.durableObject)) {
    throw new Error('The relay worker manifest is invalid; rebuild the hub service.')
  }

  const scriptName = readString(manifest, 'scriptName')
  const mainModule = readString(manifest, 'mainModule')
  const compatibilityDate = readString(manifest, 'compatibilityDate')
  const migrationTag = readString(manifest, 'migrationTag')
  const binding = readString(manifest.durableObject, 'binding')
  const className = readString(manifest.durableObject, 'className')

  return {
    code: readFileSync(join(dir, 'worker.mjs'), 'utf8'),
    scriptName,
    mainModule,
    compatibilityDate,
    migrationTag,
    durableObject: { binding, className },
  }
}

function resolveArtifactDir(): string | undefined {
  const configured = process.env[ARTIFACT_DIR_ENV]?.trim()
  const candidates = [
    configured,
    fileURLToPath(new URL('./relay', import.meta.url)),
    fileURLToPath(new URL('../../../dist/relay', import.meta.url)),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'worker.mjs')) && existsSync(join(candidate, 'manifest.json'))) {
      return candidate
    }
  }
  return undefined
}

function readString(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`The relay worker manifest is missing ${key}; rebuild the hub service.`)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
