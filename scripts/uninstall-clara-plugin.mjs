#!/usr/bin/env node
// Remove the Clara ledger plugin from OpenCode.
//
// The default removes the plugin link and the generated agent files. `--purge`
// also removes the ledger database, the alert delivery sidecar, and the
// management traces in the home agent database. Edited agent files are left
// alone unless `--force` is given.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'plugins', 'clara')
const args = new Set(process.argv.slice(2))
const purge = args.has('--purge')
const force = args.has('--force')
const dryRun = args.has('--dry-run')
const yes = args.has('--yes')

const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const opencodeDir = join(configHome, 'opencode')
const pluginsDir = join(opencodeDir, 'plugins')
const agentsDir = join(opencodeDir, 'agents')
const claraDir = process.env.CLARA_CONFIG_DIR?.trim() || join(configHome, 'clara')

const pluginLink = join(pluginsDir, 'clara')
const agentManifest = join(agentsDir, '.clara-agents.json')

const actions = []
const warnings = []

if (isLinkedPlugin()) {
  actions.push({
    description: `remove plugin link ${pluginLink}`,
    run: () => unlinkSync(pluginLink),
  })
}

removeAgentFiles()

if (purge) {
  for (const path of [
    join(claraDir, 'ledger.db'),
    join(claraDir, 'ledger.db-wal'),
    join(claraDir, 'ledger.db-shm'),
    join(claraDir, 'ledger-alerts.db'),
    join(claraDir, 'ledger-alerts.db-wal'),
    join(claraDir, 'ledger-alerts.db-shm'),
  ]) {
    if (existsSync(path)) {
      actions.push({ description: `remove ${path}`, run: () => rmSync(path, { force: true }) })
    }
  }

  const serverDb = join(claraDir, 'clara.db')
  if (existsSync(serverDb)) {
    actions.push({
      description: `remove Clara management settings and legacy tables from ${serverDb}`,
      run: () => purgeServerDatabase(serverDb),
    })
  }
}

if (actions.length === 0 && warnings.length === 0) {
  console.log('Nothing to remove.')
  process.exit(0)
}

for (const warning of warnings) console.warn(`warning ${warning}`)
for (const action of actions) console.log(`${dryRun ? 'would ' : ''}${action.description}`)

if (dryRun) process.exit(0)

if (!yes) {
  const confirmed = await confirm(`Remove ${actions.length} item(s)? [y/N] `)
  if (!confirmed) {
    console.log('Cancelled.')
    process.exit(1)
  }
}

for (const action of actions) {
  try {
    await action.run()
  } catch (cause) {
    console.error(`error ${action.description}: ${message(cause)}`)
    process.exitCode = 1
  }
}

if (process.exitCode !== 1) console.log('Clara plugin removed.')
if (warnings.length > 0) process.exitCode = 1

function isLinkedPlugin() {
  const entry = lstatSafe(pluginLink)
  if (!entry) return false
  if (!entry.isSymbolicLink()) {
    warnings.push(`${pluginLink} is not a symlink; leaving it untouched`)
    return false
  }
  const target = resolve(pluginsDir, readlinkSync(pluginLink))
  if (target !== pluginDir) {
    warnings.push(`${pluginLink} points at ${target}, not ${pluginDir}; leaving it untouched`)
    return false
  }
  return true
}

function removeAgentFiles() {
  if (!existsSync(agentManifest)) return

  let manifest
  try {
    manifest = JSON.parse(readFileSync(agentManifest, 'utf8'))
  } catch {
    warnings.push(`${agentManifest} is not valid JSON; leaving the generated agents untouched`)
    return
  }

  const agents = manifest && typeof manifest.agents === 'object' ? manifest.agents : null
  if (!agents) {
    warnings.push(`${agentManifest} has no agents map; leaving the generated agents untouched`)
    return
  }

  let skipped = 0
  for (const [id, recorded] of Object.entries(agents)) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue
    const path = join(agentsDir, `${id}.md`)
    if (!existsSync(path)) continue

    const content = readFileSync(path, 'utf8')
    if (hash(content) !== recorded && !force) {
      skipped += 1
      warnings.push(`${path} was edited after installation; leaving it untouched (use --force)`)
      continue
    }

    actions.push({ description: `remove ${path}`, run: () => unlinkSync(path) })
  }

  if (skipped === 0) {
    actions.push({
      description: `remove ${agentManifest}`,
      run: () => unlinkSync(agentManifest),
    })
  }
}

async function purgeServerDatabase(path) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run('management.enabled')
  } catch {
    // Older databases may not have a settings table.
  }
  try {
    db.exec('DROP TABLE IF EXISTS ledger_alert_state')
    db.exec('DROP TABLE IF EXISTS ledger_alert_delivery')
  } catch {
    // The legacy tables may already be gone.
  } finally {
    db.close()
  }
}

function confirm(question) {
  if (!stdin.isTTY) return Promise.resolve(false)
  const reader = createInterface({ input: stdin, output: stdout })
  return reader
    .question(question)
    .then((answer) => /^y(es)?$/i.test(answer.trim()))
    .finally(() => reader.close())
}

function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}
