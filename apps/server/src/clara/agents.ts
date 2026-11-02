import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MANIFEST_FILE = '.clara-agents.json'
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const SAFE_AGENT_ID = /^[A-Za-z0-9_-]+$/
const DISABLED_LINE = /^disabled\s*:/

type AgentManifest = {
  agents: Record<string, string>
}

export type ClaraAgentSyncResult = {
  updated: string[]
  /** Files edited after installation; they are left untouched. */
  skipped: string[]
  /** True when the installer has not written a manifest yet. */
  missingManifest: boolean
}

export type ClaraAgentSyncOptions = {
  agentsDir?: string
  manifestPath?: string
}

/**
 * The installer materializes `plugins/clara/agents.json` into OpenCode's global
 * agent directory and records a content hash for each file. The panel owns the
 * management switch, so it must keep those files in sync after installation:
 * `disabled: true` removes an agent from OpenCode's catalog.
 */
export function syncClaraAgentVisibility(
  enabled: boolean,
  options: ClaraAgentSyncOptions = {}
): ClaraAgentSyncResult {
  const agentsDir = options.agentsDir ?? defaultClaraAgentsDir()
  const manifestPath = options.manifestPath ?? join(agentsDir, MANIFEST_FILE)
  const manifest = readManifest(manifestPath)
  if (!manifest) {
    return { updated: [], skipped: [], missingManifest: true }
  }

  const next = { ...manifest.agents }
  const updated: string[] = []
  const skipped: string[] = []
  let changed = false

  for (const [id, recorded] of Object.entries(manifest.agents)) {
    if (!SAFE_AGENT_ID.test(id)) continue

    const path = join(agentsDir, `${id}.md`)
    if (!existsSync(path)) continue

    const content = readFileSync(path, 'utf8')
    // A hash mismatch means a person edited the file after installation.
    // Never overwrite that work; the installer has --force for deliberate
    // replacement.
    if (hash(content) !== recorded) {
      skipped.push(id)
      continue
    }

    const nextContent = setAgentEnabled(content, enabled)
    if (nextContent === content) continue

    writeFileSync(path, nextContent, { mode: 0o600 })
    next[id] = hash(nextContent)
    updated.push(id)
    changed = true
  }

  if (changed) writeManifest(manifestPath, next)
  return { updated, skipped, missingManifest: false }
}

/** Add or remove the `disabled` field without disturbing the rest of the file. */
export function setAgentEnabled(content: string, enabled: boolean): string {
  const match = FRONTMATTER.exec(content)
  if (!match) throw new Error('Clara agent file has no frontmatter')

  const lines = match[1].split(/\r?\n/).filter((line) => !DISABLED_LINE.test(line))
  if (!enabled) lines.push('disabled: true')

  return `---\n${lines.join('\n')}\n---\n${content.slice(match[0].length)}`
}

function defaultClaraAgentsDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configHome, 'opencode', 'agents')
}

function readManifest(path: string): AgentManifest | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { agents?: unknown }
    if (!parsed || typeof parsed.agents !== 'object' || parsed.agents === null) return undefined
    const agents: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed.agents)) {
      if (typeof value === 'string') agents[id] = value
    }
    return { agents }
  } catch {
    return undefined
  }
}

function writeManifest(path: string, agents: Record<string, string>): void {
  writeFileSync(path, `${JSON.stringify({ agents }, null, 2)}\n`, { mode: 0o600 })
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
