#!/usr/bin/env node
// Install the Clara strict enforcement adapter for OpenCode.
//
//   pnpm clara adapter install opencode
//   pnpm clara adapter uninstall
//   pnpm clara adapter status

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'plugins', 'clara-policy')
const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const pluginsDir = join(configHome, 'opencode', 'plugins')
const link = join(pluginsDir, 'clara-policy')
const force = process.argv.includes('--force')
const command = process.argv[2] ?? 'install'
const target = process.argv[3]

if (command === 'install') install(target)
else if (command === 'uninstall') uninstall()
else if (command === 'status') status()
else fail(`unknown command: ${command}`)

function install(target) {
  if (target && target !== 'opencode') fail(`unsupported adapter: ${target}`)
  if (!existsSync(join(pluginDir, 'index.ts'))) fail(`plugin not found at ${pluginDir}`)
  mkdirSync(pluginsDir, { recursive: true, mode: 0o700 })
  const existing = lstatSafe(link)
  if (existing?.isSymbolicLink()) {
    const current = resolve(pluginsDir, readlinkSync(link))
    if (current === pluginDir) {
      console.log(`ok   adapter link ${link}`)
      return
    }
    unlinkSync(link)
  } else if (existing) {
    if (!force) fail(`${link} exists and is not a symlink; re-run with --force`)
    rmSync(link, { recursive: true, force: true })
  }
  symlinkSync(pluginDir, link, 'dir')
  console.log(`link adapter ${link} -> ${pluginDir}`)
  console.log('Reload OpenCode with `opencode reload`, or restart the service.')
}

function uninstall() {
  const existing = lstatSafe(link)
  if (!existing) {
    console.log('adapter is not installed')
    return
  }
  if (existing.isSymbolicLink()) unlinkSync(link)
  else rmSync(link, { recursive: true, force: true })
  console.log(`removed ${link}`)
}

function status() {
  console.log(`adapter: ${existsSync(link) ? 'installed' : 'missing'}`)
  console.log(`path: ${link}`)
  console.log(`plugin: ${pluginDir}`)
}

function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function fail(message) {
  console.error(`error ${message}`)
  process.exit(1)
}
