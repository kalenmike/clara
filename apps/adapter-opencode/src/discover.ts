import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeGateway } from './opencode.ts'

export type OpenCodeConfig = {
  url: string
  username: string
  password?: string
}

export type DiscoveryInput = {
  url?: string
  username?: string
  password?: string
}

type ServiceFile = { url?: string; password?: string }

export async function discoverOpenCode(input: DiscoveryInput): Promise<OpenCodeConfig | undefined> {
  const candidates: OpenCodeConfig[] = []
  if (input.url) {
    candidates.push({
      url: input.url.replace(/\/+$/, ''),
      username: input.username || 'opencode',
      ...(input.password ? { password: input.password } : {}),
    })
  }

  const service = readServiceFile()
  if (service?.url) {
    candidates.push({
      url: service.url.replace(/\/+$/, ''),
      username: 'opencode',
      ...(service.password ? { password: service.password } : {}),
    })
  }

  const envUrl = process.env.OPENCODE_URL?.trim()
  if (envUrl) {
    const password = input.password ?? process.env.OPENCODE_PASSWORD
    candidates.push({
      url: envUrl.replace(/\/+$/, ''),
      username: input.username || process.env.OPENCODE_USERNAME || 'opencode',
      ...(password ? { password } : {}),
    })
  }

  for (const candidate of [
    { url: 'http://127.0.0.1:4096', username: 'opencode' },
    { url: 'http://localhost:4096', username: 'opencode' },
  ]) {
    candidates.push({ ...candidate, ...(input.password ? { password: input.password } : {}) })
  }

  for (const candidate of candidates) {
    const gateway = new OpenCodeGateway({
      url: candidate.url,
      username: candidate.username,
      ...(candidate.password ? { password: candidate.password } : {}),
    })
    const probe = await gateway.probe(1_500)
    if (probe.ok) return candidate
  }
  return undefined
}

export function readServiceFile(): ServiceFile | undefined {
  const stateHome = process.env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  const path = join(stateHome, 'opencode', 'service.json')
  try {
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ServiceFile
    return typeof parsed.url === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}
