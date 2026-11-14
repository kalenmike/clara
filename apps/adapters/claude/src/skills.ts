import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ClaudePluginEntry, ClaudeSkillEntry } from './catalog-merge.ts'

const MAX_SKILL_BYTES = 512 * 1024

type SkillRoot = {
  path: string
  /** Plugin skills are addressed as `plugin:skill` by Claude Code. */
  prefix?: string
}

/**
 * Find the skills Claude Code would load for a directory. User and project
 * skills live in `.claude/skills`; plugin skills live under the plugin root
 * that the harness reports in its init message. Discovery is best-effort and
 * never fails the catalog request.
 */
export function discoverSkills(
  directory: string,
  plugins: readonly ClaudePluginEntry[] = []
): ClaudeSkillEntry[] {
  const seen = new Set<string>()
  const skills: ClaudeSkillEntry[] = []
  for (const root of skillRoots(directory, plugins)) {
    for (const entry of readEntries(root.path)) {
      const skill = readSkill(root, entry)
      if (!skill || seen.has(skill.id)) continue
      seen.add(skill.id)
      skills.push(skill)
    }
  }
  return skills
}

function skillRoots(directory: string, plugins: readonly ClaudePluginEntry[]): SkillRoot[] {
  const roots: SkillRoot[] = []
  const project = join(directory, '.claude', 'skills')
  if (isDirectory(project)) roots.push({ path: project })
  const user = join(homedir(), '.claude', 'skills')
  if (isDirectory(user)) roots.push({ path: user })
  for (const plugin of plugins) {
    if (!plugin.path || plugin.path === 'builtin') continue
    const path = join(plugin.path, 'skills')
    if (isDirectory(path)) roots.push({ path, prefix: plugin.name })
  }
  return roots
}

function readSkill(root: SkillRoot, entry: string): ClaudeSkillEntry | undefined {
  const candidate = join(root.path, entry)
  const file = isDirectory(candidate)
    ? join(candidate, 'SKILL.md')
    : entry.endsWith('.md')
      ? candidate
      : undefined
  if (!file || !existsSync(file)) return undefined

  const content = readText(file)
  if (content === undefined) return undefined
  const front = frontmatter(content)
  const fallback = entry.endsWith('.md') ? basename(entry, '.md') : entry
  const declared = value(front.values.name)
  const base = declared ?? fallback
  const name = root.prefix ? `${root.prefix}:${base}` : base
  const description = value(front.values.description) ?? firstLine(content)

  return {
    id: name,
    name,
    ...(description ? { description } : {}),
    autoinvoke: !/^disable-model-invocation:\s*true\s*$/im.test(front.raw),
    path: file,
    content,
  }
}

function frontmatter(content: string): { raw: string; values: Record<string, string> } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { raw: '', values: {} }
  const raw = match[1] ?? ''
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!pair?.[1]) continue
    values[pair[1]] = (pair[2] ?? '').trim().replace(/^['"]|['"]$/g, '')
  }
  return { raw, values }
}

function firstLine(content: string): string | undefined {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#') || text.startsWith('---')) continue
    return text.replace(/^[*_`>-]+\s*/, '').slice(0, 200)
  }
  return undefined
}

function value(input: string | undefined): string | undefined {
  const trimmed = input?.trim()
  return trimmed ? trimmed : undefined
}

function readText(path: string): string | undefined {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return undefined
    const content = readFileSync(path, 'utf8')
    return content.length > MAX_SKILL_BYTES ? content.slice(0, MAX_SKILL_BYTES) : content
  } catch {
    return undefined
  }
}

function readEntries(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
