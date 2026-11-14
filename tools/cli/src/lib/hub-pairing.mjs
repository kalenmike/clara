// Create adapter pairing codes through the hub process.
//
// The panel creates these codes over an authenticated HTTP session. The CLI
// runs on the hub host, so it uses the same trusted local entry point as the
// existing `pair` command: a short-lived `pair-adapter` subcommand.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { detectServerTarget, localURL } from './server-control.mjs'
import { root } from './router.mjs'

const CONTAINER = 'clara-server'

export async function createAdapterPairing({
  kind,
  label,
  transport = 'local',
  wsUrl,
  docker = false,
  local = false,
} = {}) {
  if (!kind) throw new Error('choose a harness to pair')
  const target = await detectServerTarget({ docker, local })
  if (target.target === 'ambiguous') {
    throw new Error(
      `cannot choose the hub for pairing: ${target.reason}. Pass --docker or --local.`
    )
  }

  const args = ['pair-adapter', '--kind', kind, '--json']
  if (label) args.push('--label', label)
  if (transport) args.push('--transport', transport)
  const resolvedWsUrl = wsUrl ?? defaultWsUrl(target.target, transport)
  if (resolvedWsUrl) args.push('--ws-url', resolvedWsUrl)

  const result = target.target === 'container' ? runContainer(args) : runLocal(args)
  if (result.error) throw result.error
  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || 'the hub did not create a code'
    throw new Error(message)
  }
  const payload = parseJsonLine(result.stdout)
  if (!payload?.pairing?.code) throw new Error('the hub returned no pairing code')
  return payload.pairing
}

function defaultWsUrl(target, transport) {
  if (transport !== 'local') return undefined
  if (target === 'container') {
    const url = new URL(localURL())
    return `ws://${url.host}/ws`
  }
  return undefined
}

function runContainer(args) {
  return spawnSync('docker', ['exec', CONTAINER, '/app/clara-server', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  })
}

function runLocal(args) {
  const dist = join(root, 'apps', 'hub', 'server', 'dist', 'index.js')
  const source = join(root, 'apps', 'hub', 'server', 'src', 'index.ts')
  if (existsSync(dist)) {
    return spawnSync(process.execPath, [dist, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
  }
  if (existsSync(source)) {
    return spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', source, ...args],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      }
    )
  }
  throw new Error('The hub service is not built. Run `pnpm build` first.')
}

function parseJsonLine(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

export function adapterInstallCommand(kind, code) {
  return `clara-adapter-${kind} install --pair ${code}`
}
