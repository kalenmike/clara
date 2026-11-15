#!/usr/bin/env node
// Unified Clara lifecycle commands.
//
//   clara start [target] [options]
//   clara stop [target] [options]
//   clara restart [target] [options]
//   clara status [target] [options]
//   clara logs [target] [options]
//   clara backup [target] [options]
//   clara restore [target] <archive> [options]
//   clara pair [target] [options]
//
// `hub`, `web`, and `engine` are the core services. `runner`, `lab`, and `docs`
// are host-side targets. `default` means the core stack. Adapters are managed by
// the packaged `clara` command.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDocs,
  buildLab,
  docsLogPath,
  docsPort,
  docsURL,
  labLogPath,
  labPort,
  labURL,
  runLabCheck,
  startDocs,
  startLab,
  stopDocs,
  stopLab,
  typecheckDocs,
} from '../lib/dev-services.mjs'
import { clara } from '../clara.mjs'
import { logPath, stateDir } from '../lib/local-runtime.mjs'
import { followCommands, followFiles } from '../lib/multi-log.mjs'
import { openPanel } from '../lib/panel.mjs'
import { renderHelp, root, runNode, runPnpm } from '../lib/router.mjs'
import {
  readRunnerManifest,
  renderRunnerStatus,
  runRunnerForeground,
  runRunnerInstaller,
  runnerFileLogAvailable,
  runnerInstallArgs,
  runnerJournalCommand,
  runnerLogPath,
  runnerStatus,
  stopRunnerService,
} from '../lib/runner.mjs'
import { composeFile, ensureNetwork, envFile, panelURL } from '../lib/server-control.mjs'
import { SCRIPTS, ensureEngineEnv, engineURL } from '../lib/stack-control.mjs'
import {
  archiveVolumes,
  defaultBackupPath,
  existingVolumes,
  parseBackupArgs,
  parseRestoreArgs,
  readBackupManifest,
  runningContainers,
  runBackup,
  runRestore,
  targetVolumes,
} from '../lib/stack-backup.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from '../lib/status.mjs'
import { CORE_TARGETS, serviceKey, takeTarget } from '../lib/targets.mjs'
import { webURL } from '../lib/web-control.mjs'

const CORE_START_ORDER = ['engine', 'server', 'web']
const CORE_STOP_ORDER = ['web', 'server', 'engine']

const command = process.argv[2] ?? 'help'
const args = process.argv.slice(3)

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp()
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp(command)
  process.exit(0)
}

try {
  if (['start', 'stop', 'restart', 'status', 'logs'].includes(command)) {
    await lifecycle(command, args)
  } else if (command === 'backup') {
    backup(args)
  } else if (command === 'restore') {
    restore(args)
  } else if (command === 'pair') {
    await pair(args)
  } else {
    console.error(`Unknown lifecycle command: ${command}`)
    printHelp()
    process.exitCode = 2
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

async function lifecycle(name, argv) {
  const { target, args: rest } = takeTarget(argv)
  if (target === 'default' || CORE_TARGETS.includes(target)) {
    return coreLifecycle(name, target, rest)
  }
  if (target === 'runner') return runnerLifecycle(name, rest)
  if (target === 'lab') return labLifecycle(name, rest)
  if (target === 'docs') return docsLifecycle(name, rest)
  throw new Error(`unknown target: ${target}`)
}

// ---------------------------------------------------------------------------
// Core services

function coreLifecycle(name, target, argv) {
  const options = parseCoreOptions(name, target, argv)
  const keys = target === 'default' ? [...CORE_START_ORDER] : [serviceKey(target)]
  if (name === 'status') return coreStatus(keys, options, target)
  if (name === 'logs') return coreLogs(keys, options)
  if (name === 'stop') return coreStop(keys, options)
  if (name === 'start') return coreStart(keys, options, target)
  if (name === 'restart') return coreRestart(keys, options, target)
  throw new Error(`unknown core command: ${name}`)
}

function parseCoreOptions(commandName, target, argv) {
  const options = {
    docker: false,
    local: false,
    build: false,
    json: false,
    lines: 80,
    follow: true,
    open: false,
    foreground: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--docker') options.docker = true
    else if (arg === '--local') options.local = true
    else if (arg === '--build') options.build = true
    else if (arg === '--json') options.json = true
    else if (arg === '--open') options.open = true
    else if (arg === '--foreground') options.foreground = true
    else if (arg === '--no-follow') options.follow = false
    else if (arg === '--lines') {
      options.lines = positiveNumber(argv[++index], '--lines')
    } else if (arg.startsWith('--lines=')) {
      options.lines = positiveNumber(arg.slice('--lines='.length), '--lines')
    } else {
      throw new Error(`unknown option for ${commandName}: ${arg}`)
    }
  }
  if (options.local && options.docker) throw new Error('--local and --docker cannot be combined')
  if (commandName === 'stop' && options.build) throw new Error('--build is not valid for stop')
  if (commandName === 'status' && options.build) throw new Error('--build is not valid for status')
  if (commandName === 'logs' && options.build) throw new Error('--build is not valid for logs')
  if (options.foreground && (commandName !== 'start' || target !== 'engine')) {
    throw new Error('--foreground is only valid for `start engine`')
  }
  if (options.open && !['start', 'restart', 'status'].includes(commandName)) {
    throw new Error('--open is only valid for start, restart, and status')
  }
  if (options.open && target !== 'hub' && target !== 'default') {
    throw new Error('--open is only valid for the hub target')
  }
  return options
}

function modeFlag(options) {
  return options.local ? '--local' : '--docker'
}

function runCore(name, args) {
  return runNode(SCRIPTS[name], args)
}

function coreStart(keys, options, target) {
  if (keys.includes('engine') && options.foreground) {
    return runCore('engine', ['serve'])
  }
  const buildWholeStack = options.local && options.build && target === 'default'
  if (buildWholeStack) {
    console.log('\n==> building the local checkout')
    const code = runPnpm(['build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local build failed; nothing was started.')
      return code
    }
  }
  if (!options.local && keys.includes('engine')) {
    try {
      ensureEngineEnv()
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }
  if (!options.local && ensureNetwork() !== 0) return 1

  const mode = modeFlag(options)
  for (const key of keys) {
    console.log(`\n==> starting ${displayName(key)} (${options.local ? 'local' : 'docker'})`)
    const primitiveArgs = ['start', mode]
    if (options.build && !buildWholeStack) primitiveArgs.push('--build')
    const code = runCore(key, primitiveArgs)
    if (code !== 0) {
      console.error(
        `\n${displayName(key)} did not start. The stack is partially started; run \`clara stop ${mode}\` to clean up.`
      )
      return code
    }
  }
  printCoreSummary(keys, options)
  if (options.open && keys.includes('server')) openPanel(`${panelURL()}/`)
  return 0
}

function coreStop(keys, options) {
  const mode = modeFlag(options)
  let failed = false
  for (const key of CORE_STOP_ORDER.filter((entry) => keys.includes(entry))) {
    console.log(`\n==> stopping ${displayName(key)} (${options.local ? 'local' : 'docker'})`)
    if (runCore(key, ['stop', mode]) !== 0) failed = true
  }
  return failed ? 1 : 0
}

async function coreRestart(keys, options, target) {
  const stopped = coreStop(keys, options)
  if (stopped !== 0) return stopped
  return coreStart(keys, options, target)
}

async function coreStatus(keys, options, target) {
  const records = await collectStatus(keys)
  if (options.json) renderJSON(records, { stack: target === 'default' })
  else
    renderStatus(records, {
      title: target === 'default' ? 'Clara stack' : `Clara ${displayName(target)}`,
    })
  if (options.open && keys.includes('server')) openPanel(`${panelURL()}/`)
  process.exitCode = statusExitCode(records)
}

async function coreLogs(keys, options) {
  if (options.local) {
    return followFiles(
      keys.map((key) => ({ name: displayName(key), path: logPath(key) })),
      { lines: options.lines, follow: options.follow }
    )
  }
  const entries = keys.map((key) => ({
    name: displayName(key),
    ...dockerLogsCommand(key, options.lines, options.follow),
  }))
  return followCommands(entries, { follow: options.follow, cwd: root })
}

function dockerLogsCommand(key, lines, follow) {
  const composeArgs = []
  if (key === 'server' || key === 'engine') {
    const env = envFile()
    if (existsSync(env)) composeArgs.push('--env-file', env)
  }
  const file =
    key === 'server'
      ? composeFile()
      : key === 'web'
        ? join(root, 'infra', 'docker', 'web.compose.yml')
        : join(root, 'infra', 'docker', 'engine.compose.yml')
  const args = ['compose', ...composeArgs, '-f', file, 'logs', '--tail', String(lines)]
  if (follow) args.push('-f')
  args.push(key === 'server' ? 'server' : key)
  return { command: 'docker', args }
}

function printCoreSummary(keys, options) {
  console.log(`\nClara stack (${options.local ? 'local' : 'docker'})`)
  if (keys.includes('server')) console.log(`  panel:        ${panelURL()}/`)
  if (keys.includes('web')) console.log(`  web:          ${webURL()}/`)
  if (keys.includes('engine')) console.log(`  engine:       ${engineURL()}/`)
  if (keys.includes('server')) {
    console.log('')
    console.log('Open the panel with `clara status hub --open`.')
    console.log(`Pair a device with \`clara pair hub ${options.local ? '--local' : '--docker'}\`.`)
  }
}

function displayName(key) {
  if (key === 'server') return 'hub'
  return key
}

// ---------------------------------------------------------------------------
// Runner

function parseRunnerOptions(commandName, argv) {
  const options = {
    workspace: undefined,
    url: undefined,
    concurrency: undefined,
    labels: [],
    noService: false,
    foreground: false,
    purge: false,
    json: false,
    lines: 80,
    follow: true,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--workspace') options.workspace = valueOf(argv, ++index, '--workspace')
    else if (arg === '--url') options.url = valueOf(argv, ++index, '--url')
    else if (arg === '--concurrency') {
      options.concurrency = positiveNumber(valueOf(argv, ++index, '--concurrency'), '--concurrency')
    } else if (arg === '--label') options.labels.push(valueOf(argv, ++index, '--label'))
    else if (arg === '--no-service') options.noService = true
    else if (arg === '--foreground') options.foreground = true
    else if (arg === '--purge') options.purge = true
    else if (arg === '--json') options.json = true
    else if (arg === '--no-follow') options.follow = false
    else if (arg === '--lines') options.lines = positiveNumber(argv[++index], '--lines')
    else throw new Error(`unknown option for ${commandName} runner: ${arg}`)
  }
  if (options.foreground && commandName !== 'start') {
    throw new Error('--foreground is only valid for start runner')
  }
  if (options.purge && commandName !== 'stop') {
    throw new Error('--purge is only valid for stop runner')
  }
  return options
}

function runnerLifecycle(name, argv) {
  const options = parseRunnerOptions(name, argv)
  if (name === 'status') {
    const status = runnerStatus()
    renderRunnerStatus(status, { json: options.json })
    process.exitCode = status.installed && status.active === 'active' ? 0 : 1
    return
  }
  if (name === 'logs') return runnerLogs(options)
  if (name === 'start') {
    if (options.foreground) return runRunnerForeground()
    return runRunnerInstaller(runnerInstallArgs(options))
  }
  if (name === 'stop') {
    const manifest = readRunnerManifest()
    if (options.purge) return runRunnerInstaller(['uninstall'])
    for (const action of stopRunnerService(manifest)) console.log(action)
    return 0
  }
  if (name === 'restart') {
    const manifest = readRunnerManifest()
    for (const action of stopRunnerService(manifest)) console.log(action)
    return runRunnerInstaller(runnerInstallArgs(options))
  }
  throw new Error(`unknown runner command: ${name}`)
}

function runnerLogs(options) {
  const manifest = readRunnerManifest()
  if (!manifest) {
    console.error('The Clara runner is not installed. Start it with `clara start runner`.')
    return 1
  }
  if (manifest.service === 'systemd') {
    const { command: cmd, args: cmdArgs } = runnerJournalCommand(options.lines, options.follow)
    return followCommands([{ name: 'runner', command: cmd, args: cmdArgs }], {
      follow: options.follow,
    })
  }
  if (!runnerFileLogAvailable(manifest)) {
    console.error(`No runner log at ${runnerLogPath()}.`)
    return 1
  }
  return followFiles([{ name: 'runner', path: runnerLogPath() }], {
    lines: options.lines,
    follow: options.follow,
  })
}

// ---------------------------------------------------------------------------
// Lab

function parseLabOptions(commandName, argv) {
  const options = {
    workspace: undefined,
    target: undefined,
    config: undefined,
    port: undefined,
    open: true,
    build: false,
    json: false,
    check: false,
    lines: 80,
    follow: true,
    docker: false,
    local: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--workspace') options.workspace = valueOf(argv, ++index, '--workspace')
    else if (arg === '--target') options.target = valueOf(argv, ++index, '--target')
    else if (arg === '--config') options.config = valueOf(argv, ++index, '--config')
    else if (arg === '--port') options.port = positiveNumber(argv[++index], '--port')
    else if (arg === '--no-open') options.open = false
    else if (arg === '--build') options.build = true
    else if (arg === '--json') options.json = true
    else if (arg === '--check') options.check = true
    else if (arg === '--no-follow') options.follow = false
    else if (arg === '--lines') options.lines = positiveNumber(argv[++index], '--lines')
    else if (arg === '--docker') options.docker = true
    else if (arg === '--local') options.local = true
    else throw new Error(`unknown option for ${commandName} lab: ${arg}`)
  }
  if (options.docker) throw new Error('Lab is a host-only target; --docker is not supported')
  if (options.check && commandName !== 'status') {
    throw new Error('--check is only valid for status lab')
  }
  if (options.build && commandName !== 'start' && commandName !== 'restart') {
    throw new Error('--build is only valid for start and restart')
  }
  if (options.port && commandName === 'start') writePort('lab', options.port)
  return options
}

async function labLifecycle(name, argv) {
  const options = parseLabOptions(name, argv)
  if (name === 'status') {
    if (options.check) return runLabCheck({ ...options, json: options.json })
    return singleStatus('lab', options.json)
  }
  if (name === 'logs') {
    return followFiles([{ name: 'lab', path: labLogPath() }], {
      lines: options.lines,
      follow: options.follow,
    })
  }
  if (name === 'start') {
    if (options.build && buildLab() !== 0) return 1
    return startLabWithSummary(options)
  }
  if (name === 'stop') {
    finalizeStop('lab', await stopLab())
    return 0
  }
  if (name === 'restart') {
    finalizeStop('lab', await stopLab())
    if (options.build && buildLab() !== 0) return 1
    return startLabWithSummary(options)
  }
  throw new Error(`unknown lab command: ${name}`)
}

async function startLabWithSummary(options) {
  options.port = options.port ?? labPort()
  writePort('lab', options.port)
  console.log('\n==> starting Clara Lab')
  const result = await startLab(options)
  finalizeStart('lab', result, labURL(options.port))
  return result.status === 'started' || result.status === 'running' ? 0 : 1
}

// ---------------------------------------------------------------------------
// Docs

function parseDocsOptions(commandName, argv) {
  const options = {
    port: undefined,
    open: true,
    build: false,
    preview: false,
    json: false,
    check: false,
    typecheck: false,
    lines: 80,
    follow: true,
    docker: false,
    local: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--port') options.port = positiveNumber(argv[++index], '--port')
    else if (arg === '--no-open') options.open = false
    else if (arg === '--build') options.build = true
    else if (arg === '--preview') options.preview = true
    else if (arg === '--json') options.json = true
    else if (arg === '--check') options.check = true
    else if (arg === '--typecheck') options.typecheck = true
    else if (arg === '--no-follow') options.follow = false
    else if (arg === '--lines') options.lines = positiveNumber(argv[++index], '--lines')
    else if (arg === '--docker') options.docker = true
    else if (arg === '--local') options.local = true
    else throw new Error(`unknown option for ${commandName} docs: ${arg}`)
  }
  if (options.docker) throw new Error('Docs is a host-only target; --docker is not supported')
  if (options.check && commandName !== 'status') {
    throw new Error('--check is only valid for status docs')
  }
  if (options.typecheck && commandName !== 'status') {
    throw new Error('--typecheck is only valid for status docs')
  }
  if (options.build && commandName !== 'start' && commandName !== 'restart') {
    throw new Error('--build is only valid for start and restart')
  }
  if (options.preview && commandName !== 'start' && commandName !== 'restart') {
    throw new Error('--preview is only valid for start and restart')
  }
  if (options.port && commandName === 'start') writePort('docs', options.port)
  return options
}

async function docsLifecycle(name, argv) {
  const options = parseDocsOptions(name, argv)
  if (name === 'status') {
    if (options.check) {
      return runNode(
        join(root, 'tools/cli/src/commands/docs-check.mjs'),
        options.json ? ['--json'] : []
      )
    }
    if (options.typecheck) return typecheckDocs()
    return singleStatus('docs', options.json)
  }
  if (name === 'logs') {
    return followFiles([{ name: 'docs', path: docsLogPath() }], {
      lines: options.lines,
      follow: options.follow,
    })
  }
  if (name === 'start') {
    if (options.build) {
      if (buildDocs() !== 0) return 1
      options.preview = true
    }
    return startDocsWithSummary(options)
  }
  if (name === 'stop') {
    finalizeStop('docs', await stopDocs())
    return 0
  }
  if (name === 'restart') {
    finalizeStop('docs', await stopDocs())
    if (options.build) {
      if (buildDocs() !== 0) return 1
      options.preview = true
    }
    return startDocsWithSummary(options)
  }
  throw new Error(`unknown docs command: ${name}`)
}

async function startDocsWithSummary(options) {
  options.port = options.port ?? docsPort()
  writePort('docs', options.port)
  console.log('\n==> starting the docs site')
  const result = await startDocs(options)
  finalizeStart('docs', result, docsURL(options.port))
  return result.status === 'started' || result.status === 'running' ? 0 : 1
}

// ---------------------------------------------------------------------------
// Shared lifecycle helpers

async function singleStatus(name, json) {
  const [record] = await collectStatus([name])
  if (json) renderJSON([record])
  else renderStatus([record], { title: `Clara ${name}` })
  process.exitCode = statusExitCode([record])
}

function finalizeStart(name, result, url) {
  if (result.status === 'started' || result.status === 'running') {
    console.log(`${name}: ${url}`)
    console.log(`  logs: ${logPath(name)}`)
    return
  }
  console.error(`${name} did not start: ${result.reason ?? result.status}`)
  if (result.log) console.error(`  log: ${result.log}`)
}

function finalizeStop(name, result) {
  if (result.status === 'stopped') console.log(`stopped ${name} (pid ${result.pid})`)
  else if (result.status === 'not-running' || result.status === 'stale')
    console.log(`${name} is not running`)
  else if (result.status === 'foreign') {
    console.error(`${name} is listening on its port but was not started by this checkout.`)
    process.exitCode = 1
  } else console.error(`could not stop ${name}: ${result.reason ?? result.status}`)
}

function writePort(name, port) {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 })
  writeFileSync(join(stateDir(), `${name}.port`), `${port}\n`, { mode: 0o600 })
}

// ---------------------------------------------------------------------------
// Backup and restore

function backup(argv) {
  const { target, args: rest } = takeTarget(argv, ['default', 'hub', 'engine'])
  const options = parseBackupArgs(rest)
  if (refuseRunning(target, 'back up')) return
  const volumes = targetVolumes(target).filter((name) => existingVolumes([name]).length > 0)
  if (volumes.length === 0) {
    console.error(`error: no Clara volumes found for ${target}. Start the stack once first.`)
    process.exitCode = 1
    return
  }
  const output = options.output ?? defaultBackupPath(target)
  console.log(`writing ${output}`)
  const code = runBackup({ output, target, volumes })
  if (code !== 0) {
    console.error('error: backup failed')
    process.exitCode = code
    return
  }
  console.log(`backup written to ${output}`)
}

function restore(argv) {
  const first = argv.find((arg) => !arg.startsWith('-'))
  let target = 'default'
  let rest = [...argv]
  if (first && ['default', 'hub', 'engine'].includes(first)) {
    target = first
    rest.splice(rest.indexOf(first), 1)
  }
  const options = parseRestoreArgs(rest)
  if (!existsSync(options.archive)) {
    console.error(`error: archive not found: ${options.archive}`)
    process.exitCode = 1
    return
  }
  const manifest = readBackupManifest({ archive: options.archive })
  const fromArchive = manifest?.volumes ?? archiveVolumes({ archive: options.archive })
  const available = fromArchive.length > 0 ? fromArchive : targetVolumes('default')
  const volumes = target === 'default' ? available : targetVolumes(target)
  const missing = volumes.filter((name) => !available.includes(name))
  if (missing.length > 0) {
    console.error(`error: the archive does not contain ${missing.join(', ')}`)
    process.exitCode = 1
    return
  }
  if (refuseRunning(target, 'restore')) return
  const existing = existingVolumes(volumes)
  if (existing.length > 0 && !options.force) {
    console.error(
      `error: refusing to overwrite ${existing.join(', ')}. Re-run with --force to replace the volume contents.`
    )
    process.exitCode = 1
    return
  }
  console.log(`restoring ${options.archive}`)
  const code = runRestore({ archive: options.archive, volumes })
  if (code !== 0) {
    console.error('error: restore failed')
    process.exitCode = code
    return
  }
  console.log('restore complete; start the stack with `clara start`')
}

function refuseRunning(target, action) {
  const containers = runningContainers(target)
  if (containers.length === 0) return false
  console.error(
    `error: cannot ${action} while ${containers.join(', ')} ${containers.length === 1 ? 'is' : 'are'} running. Run \`clara stop\` first.`
  )
  process.exitCode = 1
  return true
}

// ---------------------------------------------------------------------------
// Pairing

async function pair(argv) {
  const { args: rest } = takeTarget(argv, ['default', 'hub'])
  return pairHub(rest)
}

function pairHub(argv) {
  const forwarded = argv
  return runNode(join(root, 'tools/cli/src/commands/server.mjs'), ['pair', ...forwarded])
}

// ---------------------------------------------------------------------------
// Arguments and help

function valueOf(argv, index, flag) {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function positiveNumber(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive number`)
  return parsed
}

function printHelp(topic) {
  console.log(renderHelp(clara, topic ? [topic] : []))
}
