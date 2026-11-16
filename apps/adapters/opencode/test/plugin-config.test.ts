import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installOpenCodePluginEntry,
  openCodePluginConfigured,
  readAdapterPluginPath,
  removeOpenCodePluginEntry,
} from '../src/plugin-config.ts'

const roots: string[] = []

function scratch(config?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-plugin-config-'))
  roots.push(root)
  const path = join(root, 'opencode.json')
  if (config !== undefined) writeFileSync(path, JSON.stringify(config, null, 2))
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('OpenCode plugin config', () => {
  it('creates the config and registers the plugin directory', () => {
    const path = scratch()
    const plugin = '/opt/clara/adapters/opencode/0.1.0/plugin'

    expect(installOpenCodePluginEntry({ configPath: path, pluginPath: plugin })).toBe(true)

    const config = JSON.parse(readFileSync(path, 'utf8'))
    expect(config.plugins).toEqual([plugin])
    expect(openCodePluginConfigured(path, plugin)).toBe(true)
  })

  it('keeps unrelated plugins and replaces the previous install entry', () => {
    const previous = '/opt/clara/adapters/opencode/0.1.0/plugin'
    const current = '/opt/clara/adapters/opencode/0.2.0/plugin'
    const path = scratch({ plugins: ['opencode-notifier', previous], theme: 'dark' })

    installOpenCodePluginEntry({
      configPath: path,
      pluginPath: current,
      previousPath: previous,
    })

    const config = JSON.parse(readFileSync(path, 'utf8'))
    expect(config.plugins).toEqual(['opencode-notifier', current])
    expect(config.theme).toBe('dark')
    expect(openCodePluginConfigured(path, previous)).toBe(false)
    expect(openCodePluginConfigured(path, current)).toBe(true)
  })

  it('does not duplicate an entry that is already registered', () => {
    const plugin = '/opt/clara/adapters/opencode/0.1.0/plugin'
    const path = scratch({ plugins: [plugin] })

    installOpenCodePluginEntry({ configPath: path, pluginPath: plugin })

    const config = JSON.parse(readFileSync(path, 'utf8'))
    expect(config.plugins).toEqual([plugin])
  })

  it('removes the entry and leaves an empty plugins list out of the config', () => {
    const plugin = '/opt/clara/adapters/opencode/0.1.0/plugin'
    const path = scratch({ plugins: [plugin] })

    expect(removeOpenCodePluginEntry(path, plugin)).toBe(true)

    const config = JSON.parse(readFileSync(path, 'utf8'))
    expect(config.plugins).toBeUndefined()
  })

  it('replaces an unrecorded Clara plugin entry from a manual repair', () => {
    const manual = '/opt/clara/adapters/opencode/0.0.9/plugin'
    const current = '/opt/clara/adapters/opencode/0.1.0/plugin'
    const path = scratch({ plugins: ['opencode-notifier', manual] })

    installOpenCodePluginEntry({ configPath: path, pluginPath: current })

    const config = JSON.parse(readFileSync(path, 'utf8'))
    expect(config.plugins).toEqual(['opencode-notifier', current])
  })

  it('reads the plugin path recorded by the last install', () => {
    const plugin = '/opt/clara/adapters/opencode/0.1.0/plugin'
    const path = scratch({ runner: { enabled: false }, plugin })

    expect(readAdapterPluginPath(path)).toBe(plugin)
    expect(readAdapterPluginPath(scratch())).toBeUndefined()
  })
})
