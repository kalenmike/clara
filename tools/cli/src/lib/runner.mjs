// Shared script runner lifecycle helpers.
//
// The runner is installed by `@clara/runner`'s install CLI. The CLI reads the
// same manifest and service metadata so status and logs do not duplicate the
// installer logic.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { root, runNode, runPnpm } from './router.mjs'

export const RUNNER_SERVICE = 'clara-runner'

export function claraConfigDir(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara')
}

export function runnerManifestPath(env = process.env) {
  return join(claraConfigDir(env), 'adapter.json')
}

export function runnerConfigPath(env = process.env) {
  return join(claraConfigDir(env), 'runner.json')
}

export function runnerLogPath(env = process.env) {
  return join(claraConfigDir(env), 'runner.log')
}

export function readRunnerManifest(env = process.env) {
  const path = runnerManifestPath(env)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.version === 1 && parsed.runner ? parsed.runner : undefined
  } catch {
    return undefined
  }
}

export function runnerStatus(env = process.env) {
  const manifest = readRunnerManifest(env)
  if (!manifest) {
    return {
      installed: false,
      configured: existsSync(runnerConfigPath(env)),
      config: runnerConfigPath(env),
      service: 'none',
      active: 'unknown',
    }
  }
  return {
    installed: true,
    configured: existsSync(runnerConfigPath(env)),
    config: runnerConfigPath(env),
    service: manifest.service,
    active: serviceActive(manifest.service),
    manifest,
  }
}

function serviceActive(service) {
  if (service === 'systemd') {
    const result = spawnSync('systemctl', ['--user', 'is-active', RUNNER_SERVICE], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    return result.status === 0 ? 'active' : 'inactive'
  }
  if (service === 'launchd') {
    const result = spawnSync('launchctl', ['list', 'ai.clara.runner'], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    return result.status === 0 ? 'active' : 'inactive'
  }
  return 'foreground'
}

export function renderRunnerStatus(status, { json = false } = {}) {
  if (json) {
    console.log(
      JSON.stringify(
        { ok: status.installed && status.active === 'active', target: 'runner', runner: status },
        null,
        2
      )
    )
    return
  }
  if (!status.installed) {
    console.log('Clara runner')
    console.log('')
    console.log('installed  no')
    console.log(`config     ${status.config}`)
    console.log('Start it with `clara start runner`.')
    return
  }
  console.log('Clara runner')
  console.log('')
  console.log(`workspace  ${status.manifest.workspace}`)
  console.log(`engine ${status.manifest.url}`)
  console.log(`concurrency ${status.manifest.concurrency}`)
  console.log(
    `labels     ${status.manifest.labels.length ? status.manifest.labels.join(', ') : '—'}`
  )
  console.log(`service    ${status.service} (${status.active})`)
  console.log(`config     ${status.config}`)
  console.log(`log        ${runnerLogPath()}`)
}

export function runnerInstallArgs(options = {}) {
  const args = ['install']
  if (options.workspace) args.push('--workspace', options.workspace)
  if (options.url) args.push('--url', options.url)
  if (options.concurrency) args.push('--concurrency', String(options.concurrency))
  for (const label of options.labels ?? []) args.push('--label', label)
  if (options.noService) args.push('--no-service')
  return args
}

export function runnerForegroundArgs() {
  return ['runner']
}

export function runRunnerInstaller(args) {
  return runCli(args)
}

export function runRunnerForeground(args = []) {
  return runCli(['runner', ...args])
}

function runCli(args) {
  const dist = join(root, 'packages', 'adapters', 'runner', 'dist', 'install-cli.js')
  const source = join(root, 'packages', 'adapters', 'runner', 'src', 'install-cli.ts')
  if (existsSync(dist)) {
    return runNode(dist, args)
  }
  if (existsSync(source)) {
    return runNode(source, args, {
      nodeArgs: ['--experimental-strip-types', '--no-warnings'],
    })
  }
  return runPnpm(['--filter', '@clara/runner', 'exec', 'tsx', 'src/install-cli.ts', ...args], {
    cwd: root,
  })
}

export function stopRunnerService(manifest) {
  if (!manifest) return [RUNNER_SERVICE, 'runner is not installed']
  const actions = []
  if (manifest.service === 'systemd') {
    const result = spawnSync('systemctl', ['--user', 'disable', '--now', RUNNER_SERVICE], {
      encoding: 'utf8',
    })
    actions.push(
      result.status === 0
        ? `stopped ${RUNNER_SERVICE}`
        : `could not stop ${RUNNER_SERVICE}; run systemctl --user disable --now ${RUNNER_SERVICE}`
    )
    return actions
  }
  if (manifest.service === 'launchd' && manifest.unitPath) {
    const result = spawnSync('launchctl', ['unload', manifest.unitPath], { encoding: 'utf8' })
    actions.push(
      result.status === 0
        ? `unloaded ${manifest.unitPath}`
        : `could not unload ${manifest.unitPath}`
    )
    return actions
  }
  return ['runner service is not managed by systemd or launchd']
}

export function runnerFileLogAvailable(manifest) {
  return manifest?.service !== 'systemd' && existsSync(runnerLogPath())
}

export function runnerJournalCommand(lines = 80, follow = true) {
  const args = ['--user', '-u', RUNNER_SERVICE, '-n', String(lines)]
  if (follow) args.push('-f')
  return { command: 'journalctl', args }
}
