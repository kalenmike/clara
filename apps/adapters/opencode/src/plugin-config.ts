import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'
import { isRecord, readJson, writeJson } from './mcp-config.ts'

/**
 * The Clara policy plugin is a local plugin directory, and OpenCode only
 * rescans its plugins directory when the config changes. Registering the
 * directory in `plugins` makes every install and upgrade a config change, so a
 * running OpenCode server reloads the plugin without a restart.
 */
type JsonRecord = Record<string, unknown>

function pluginEntryTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (isRecord(entry) && typeof entry.package === 'string') return entry.package
  return undefined
}

function normalizeEntryPath(entry: string): string {
  if (entry.startsWith('file://')) {
    try {
      return resolve(fileURLToPath(entry))
    } catch {
      return resolve(entry)
    }
  }
  return resolve(entry)
}

function pluginEntries(config: JsonRecord): unknown[] {
  return Array.isArray(config.plugins) ? config.plugins : []
}

function isSameEntry(entry: unknown, pluginPath: string): boolean {
  const target = pluginEntryTarget(entry)
  if (!target) return false
  return normalizeEntryPath(target) === normalizeEntryPath(pluginPath)
}

/**
 * Older installs and manual repairs can leave a Clara plugin directory in
 * `plugins` without a recorded path. A Clara plugin entry is a local directory
 * ending in `plugin` under an `adapters/opencode` tree.
 */
function isClaraPluginEntry(entry: unknown): boolean {
  const target = pluginEntryTarget(entry)
  if (!target) return false
  const normalized = normalizeEntryPath(target)
  return (
    normalized.endsWith(`${sep}plugin`) && normalized.includes(`${sep}adapters${sep}opencode${sep}`)
  )
}

/** The plugin directory recorded by the last install, if any. */
export function readAdapterPluginPath(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined
  try {
    const config = readJson(configPath)
    return typeof config.plugin === 'string' && config.plugin.trim() ? config.plugin : undefined
  } catch {
    return undefined
  }
}

export function openCodePluginConfigured(configPath: string, pluginPath: string): boolean {
  if (!existsSync(configPath)) return false
  try {
    const config = readJson(configPath)
    return pluginEntries(config).some((entry) => isSameEntry(entry, pluginPath))
  } catch {
    return false
  }
}

export interface InstallPluginEntryInput {
  configPath: string
  pluginPath: string
  /** The path the previous install registered, replaced instead of duplicated. */
  previousPath?: string
}

/**
 * Add the plugin directory to `plugins`, replacing the entry from the previous
 * install. Returns false when the config cannot be parsed (for example a JSONC
 * file); the caller keeps the plugin link and warns instead.
 */
export function installOpenCodePluginEntry(input: InstallPluginEntryInput): boolean {
  const config = existsSync(input.configPath) ? readJson(input.configPath) : {}
  const current = pluginEntries(config)
  const next = current.filter(
    (entry) =>
      !isSameEntry(entry, input.pluginPath) &&
      !(input.previousPath && isSameEntry(entry, input.previousPath)) &&
      !isClaraPluginEntry(entry)
  )
  next.push(input.pluginPath)
  config.plugins = next
  writeJson(input.configPath, config)
  // Always write: the config save is what makes a running OpenCode server
  // rescan plugins. The flag only selects the install action message.
  return JSON.stringify(next) !== JSON.stringify(current)
}

/** Remove every entry for the given plugin directory. */
export function removeOpenCodePluginEntry(
  configPath: string,
  pluginPath: string | undefined
): boolean {
  if (!pluginPath || !existsSync(configPath)) return false
  const config = readJson(configPath)
  const current = pluginEntries(config)
  const next = current.filter((entry) => !isSameEntry(entry, pluginPath))
  if (next.length === current.length) return false
  if (next.length) config.plugins = next
  else delete config.plugins
  writeJson(configPath, config)
  return true
}
