import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { agentStatus, installAgentFile, removeAgentFile } from './agent-file.ts'
import { removeGeneratedCommand } from './command.ts'
import {
  installOpenCodeMcp,
  isRecord,
  openCodeMcpConfigured,
  readJson,
  removeOpenCodeMcp,
  writeJson,
  type McpEntry,
} from './mcp-config.ts'
import { openCodeAgentSource, openCodePluginRoot } from './package-paths.ts'
import {
  installOpenCodePluginEntry,
  openCodePluginConfigured,
  readAdapterPluginPath,
  removeOpenCodePluginEntry,
} from './plugin-config.ts'
import { opencodePaths } from './opencode-paths.ts'

export interface OpenCodeInstallInput {
  force: boolean
  mcp: boolean
  url: string
  mcpEntry?: McpEntry
  noRunner?: boolean
  dryRun?: boolean
  now?: number
}

export interface OpenCodeBindingManifest {
  pluginPath: string
  agentPath: string
  configPath: string
  mcp: boolean
  installedAt: number
}

export interface OpenCodeInstallResult {
  manifest: OpenCodeBindingManifest
  actions: string[]
  warnings: string[]
}

function linkPlugin(target: string, link: string, force: boolean, actions: string[]): void {
  mkdirSync(dirname(link), { recursive: true, mode: 0o700 })
  if (existsSync(link) || isSymlink(link)) {
    if (isSymlink(link)) {
      const current = readlinkSync(link)
      if (current === target) {
        actions.push(`keep plugin link ${link}`)
        return
      }
      unlinkSync(link)
    } else if (!force) {
      throw new Error(`${link} exists and was not created by this installer; re-run with --force`)
    } else {
      rmSync(link, { recursive: true, force: true })
    }
  }
  try {
    symlinkSync(target, link, 'dir')
    actions.push(`link plugin ${link} -> ${target}`)
  } catch {
    cpSync(target, link, { recursive: true })
    actions.push(`copy plugin ${link} <- ${target}`)
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function writeAdapterConfig(
  path: string,
  pluginPath: string,
  noRunner: boolean | undefined,
  actions: string[]
): void {
  const current = existsSync(path) ? readJson(path) : {}
  const runner = isRecord(current.runner) ? current.runner : {}
  const enabled = noRunner !== true
  const next = {
    ...current,
    runner: { ...runner, enabled },
    plugin: pluginPath,
  }
  writeJson(path, next)
  actions.push(`write adapter config ${path} (embedded runner ${enabled ? 'enabled' : 'disabled'})`)
}

export function installOpenCode(input: OpenCodeInstallInput): OpenCodeInstallResult {
  const paths = opencodePaths()
  const target = openCodePluginRoot()
  if (!existsSync(join(target, 'index.ts')) && !existsSync(join(target, 'index.js'))) {
    throw new Error(`The OpenCode plugin is missing its entry point at ${target}`)
  }
  const agentSource = openCodeAgentSource()
  if (!existsSync(agentSource)) {
    throw new Error(`The Clara agent definition is missing at ${agentSource}`)
  }
  const actions: string[] = []
  const warnings: string[] = []
  const now = input.now ?? Date.now()

  if (!input.dryRun) {
    linkPlugin(target, paths.plugin, input.force, actions)
    const agent = installAgentFile({
      id: 'clara',
      source: agentSource,
      destination: paths.agent,
      manifestPath: paths.agentManifest,
      force: input.force,
    })
    actions.push(`${agent.written ? 'write' : 'keep'} agent ${agent.path}`)
    // The plugin directory is versioned, so register the current path in the
    // OpenCode config. The config save is also what makes a running server
    // rescan plugins, which keeps upgrades from outliving the loaded plugin.
    const previous = readAdapterPluginPath(paths.adapterConfig)
    try {
      const changed = installOpenCodePluginEntry({
        configPath: paths.config,
        pluginPath: target,
        ...(previous ? { previousPath: previous } : {}),
      })
      actions.push(`${changed ? 'register' : 'keep'} plugin ${target} in ${paths.config}`)
    } catch (error) {
      warnings.push(
        `Could not register the Clara policy plugin in ${paths.config}: ${messageOf(error)}. ` +
          `Add ${target} to its plugins list or restart OpenCode after this install.`
      )
    }
    writeAdapterConfig(paths.adapterConfig, target, input.noRunner, actions)
    if (input.mcp) {
      if (!input.mcpEntry) throw new Error('The MCP entry path is unavailable')
      installOpenCodeMcp(paths.config, input.mcpEntry)
      actions.push(`register MCP bridge in ${paths.config}`)
    }
    if (removeGeneratedCommand(paths.command)) {
      actions.push(`remove old /pipeline command ${paths.command}`)
    }
  } else {
    actions.push(`link plugin ${paths.plugin} -> ${target}`)
    actions.push(`write agent ${paths.agent}`)
    actions.push(`register plugin ${target} in ${paths.config}`)
    actions.push(
      `write adapter config ${paths.adapterConfig} (embedded runner ${
        input.noRunner === true ? 'disabled' : 'enabled'
      })`
    )
    if (input.mcp) actions.push(`register MCP bridge in ${paths.config}`)
  }

  return {
    manifest: {
      pluginPath: paths.plugin,
      agentPath: paths.agent,
      configPath: paths.adapterConfig,
      mcp: input.mcp,
      installedAt: now,
    },
    actions,
    warnings,
  }
}

export function uninstallOpenCode(input: { force: boolean; dryRun?: boolean }): string[] {
  const paths = opencodePaths()
  const actions: string[] = []
  const registered = readAdapterPluginPath(paths.adapterConfig)
  const link = paths.plugin
  if (isSymlink(link)) {
    if (!input.dryRun) unlinkSync(link)
    actions.push(`remove plugin link ${link}`)
  } else if (existsSync(link)) {
    if (!input.force) {
      actions.push(`keep ${link}: it is not a generated link (use --force)`)
    } else {
      if (!input.dryRun) rmSync(link, { recursive: true, force: true })
      actions.push(`remove plugin directory ${link}`)
    }
  }
  if (!input.dryRun) {
    for (const pluginPath of new Set([registered, openCodePluginRoot()])) {
      try {
        if (pluginPath && removeOpenCodePluginEntry(paths.config, pluginPath)) {
          actions.push(`remove plugin ${pluginPath} from ${paths.config}`)
        }
      } catch {
        // Leave an unreadable config untouched; the plugin link is already gone.
      }
    }
    const agent = removeAgentFile({
      id: 'clara',
      destination: paths.agent,
      manifestPath: paths.agentManifest,
    })
    if (agent.removed) actions.push(`remove agent ${agent.path}`)
    else if (agent.kept) actions.push(`keep modified agent ${agent.path}`)
    if (existsSync(paths.adapterConfig)) {
      const current = readJson(paths.adapterConfig)
      const runner = isRecord(current.runner) ? { ...current.runner } : {}
      delete runner.enabled
      const next: Record<string, unknown> = { ...current, runner }
      delete next.plugin
      if (Object.keys(runner).length) {
        writeJson(paths.adapterConfig, next)
      } else if (existsSync(paths.adapterConfig)) {
        unlinkSync(paths.adapterConfig)
      }
      actions.push(`remove adapter config ${paths.adapterConfig}`)
    }
    if (removeOpenCodeMcp(paths.config)) actions.push(`remove MCP bridge from ${paths.config}`)
  } else {
    actions.push(`remove agent ${paths.agent}`)
    actions.push(`remove plugin ${registered ?? openCodePluginRoot()} from ${paths.config}`)
    actions.push(`remove adapter config ${paths.adapterConfig}`)
    actions.push(`remove MCP bridge from ${paths.config}`)
  }
  return actions
}

export interface OpenCodeStatus {
  plugin: 'linked' | 'copied' | 'missing'
  /** The plugin directory is registered in the OpenCode config. */
  registered: boolean
  agent: string
  config: boolean
  mcp: boolean
}

export function openCodeStatus(): OpenCodeStatus {
  const paths = opencodePaths()
  const plugin = isSymlink(paths.plugin)
    ? 'linked'
    : existsSync(paths.plugin)
      ? 'copied'
      : 'missing'
  return {
    plugin,
    registered: openCodePluginConfigured(paths.config, openCodePluginRoot()),
    agent: agentStatus(paths.agent, paths.agentManifest),
    config: existsSync(paths.adapterConfig),
    mcp: openCodeMcpConfigured(paths.config),
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
