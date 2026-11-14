/**
 * The Agent SDK exposes full metadata from `initializationResult()` and a
 * narrower name list in every `system/init` message. Keep the metadata the
 * catalog already knows when a live turn refreshes the names.
 */

export type ClaudeCommandEntry = {
  name: string
  description?: string
}

export type ClaudeAgentEntry = {
  name: string
  description?: string
  model?: string
}

export type ClaudeSkillEntry = {
  id: string
  name: string
  description?: string
  autoinvoke?: boolean
  path: string
  content: string
}

export type ClaudePluginEntry = {
  name: string
  path: string
  version?: string
}

export function mergeCommands(
  previous: readonly ClaudeCommandEntry[],
  names: readonly string[]
): ClaudeCommandEntry[] {
  if (names.length === 0) return [...previous]
  const byName = new Map(previous.map((command) => [command.name, command]))
  return names.map((name) => byName.get(name) ?? { name })
}

export function mergeAgents(
  previous: readonly ClaudeAgentEntry[],
  names: readonly string[]
): ClaudeAgentEntry[] {
  if (names.length === 0) return [...previous]
  const byName = new Map(previous.map((agent) => [agent.name, agent]))
  return names.map((name) => byName.get(name) ?? { name })
}

/**
 * Claude exposes skills as names in the init message. Keep the entries the
 * catalog already has and fill a description from a matching command, so the
 * skill menu does not lose context on the first turn.
 */
export function mergeSkills(
  previous: readonly ClaudeSkillEntry[],
  names: readonly string[],
  commands: readonly ClaudeCommandEntry[]
): ClaudeSkillEntry[] {
  if (names.length === 0) return [...previous]
  const byID = new Map(previous.map((skill) => [skill.id, skill]))
  const descriptions = new Map(
    commands.flatMap((command) =>
      command.description ? [[command.name, command.description] as const] : []
    )
  )
  return names.map((name) => {
    const existing = byID.get(name)
    if (existing) return existing
    const description = descriptions.get(name)
    return {
      id: name,
      name,
      ...(description ? { description } : {}),
      path: '',
      content: description ?? '',
    }
  })
}

export function mergePlugins(
  previous: readonly ClaudePluginEntry[],
  plugins: readonly ClaudePluginEntry[]
): ClaudePluginEntry[] {
  if (plugins.length === 0) return [...previous]
  const seen = new Set<string>()
  const next: ClaudePluginEntry[] = []
  for (const plugin of plugins) {
    if (!plugin.name || !plugin.path || seen.has(plugin.name)) continue
    seen.add(plugin.name)
    next.push({
      name: plugin.name,
      path: plugin.path,
      ...(plugin.version ? { version: plugin.version } : {}),
    })
  }
  return next
}
