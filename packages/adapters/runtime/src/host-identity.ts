import { access, readFile } from 'node:fs/promises'
import { arch as osArch, hostname as osHostname, platform as osPlatform } from 'node:os'
import type { AdapterHostIdentity, HarnessContainerRuntime } from '@clara/shared-types'

export type HostIdentityDeps = {
  hostname: () => string
  platform: () => string
  arch: () => string
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  env: () => NodeJS.ProcessEnv
}

const defaults: HostIdentityDeps = {
  hostname: () => osHostname(),
  platform: () => osPlatform(),
  arch: () => osArch(),
  exists: async (path) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  },
  read: (path) => readFile(path, 'utf8'),
  env: () => process.env,
}

/** Longest hostname accepted from the operating system or a container. */
export const MAX_HOSTNAME_LENGTH = 253

/**
 * Describe the machine or container running the adapter. Every value is a
 * best-effort display hint: a missing marker simply leaves the container field
 * absent instead of guessing.
 */
export async function readHostIdentity(
  deps: Partial<HostIdentityDeps> = {}
): Promise<AdapterHostIdentity> {
  const resolved: HostIdentityDeps = { ...defaults, ...deps }
  const hostname = normalizeHostname(resolved.hostname())
  const platform = normalizeToken(resolved.platform())
  const arch = normalizeToken(resolved.arch())
  const container = await detectContainer(resolved)
  return {
    ...(hostname ? { hostname } : {}),
    ...(platform ? { platform } : {}),
    ...(arch ? { arch } : {}),
    ...(container ? { container } : {}),
  }
}

async function detectContainer(deps: HostIdentityDeps): Promise<AdapterHostIdentity['container']> {
  const env = deps.env()
  if (env.KUBERNETES_SERVICE_HOST?.trim()) return { runtime: 'kubernetes' }
  if (await deps.exists('/.dockerenv')) return { runtime: 'docker' }
  if (await deps.exists('/run/.containerenv')) return { runtime: 'podman' }

  const hint = containerHint(env.CLARA_ADAPTER_CONTAINER)
  if (hint) return { runtime: hint }

  const cgroup = await readOptional(deps, '/proc/self/cgroup')
  if (!cgroup) return undefined
  const runtime = containerRuntimeFromCgroup(cgroup)
  return runtime ? { runtime } : undefined
}

function containerHint(value: string | undefined): HarnessContainerRuntime | undefined {
  const text = value?.trim().toLowerCase()
  if (text === 'docker' || text === 'podman' || text === 'kubernetes') return text
  if (text === 'container' || text === 'other') return 'other'
  return undefined
}

function containerRuntimeFromCgroup(table: string): HarnessContainerRuntime | undefined {
  const text = table.toLowerCase()
  if (text.includes('kubepods')) return 'kubernetes'
  if (text.includes('libpod') || text.includes('podman')) return 'podman'
  if (text.includes('docker') || text.includes('containerd')) return 'docker'
  return undefined
}

async function readOptional(deps: HostIdentityDeps, path: string): Promise<string | undefined> {
  try {
    return await deps.read(path)
  } catch {
    return undefined
  }
}

function normalizeHostname(value: string | undefined): string | undefined {
  return normalizeToken(value)?.slice(0, MAX_HOSTNAME_LENGTH)
}

function normalizeToken(value: string | undefined): string | undefined {
  if (!value) return undefined
  // Control characters are never meaningful in a hostname and must not reach
  // the panel or the database.
  let cleaned = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x1f && code !== 0x7f) cleaned += character
  }
  return cleaned.trim() || undefined
}
