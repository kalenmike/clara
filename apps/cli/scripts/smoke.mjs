#!/usr/bin/env node
// Build the host binary and drive it end to end: version, status, start, the
// three health endpoints, the panel shell, and a clean stop with no pid files.
// Everything runs against temporary Clara directories and ports chosen by Node,
// so the smoke test never touches a real install or a default port.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../..')
const target = hostTarget()
const requestedBinary = arg('--binary')
const binary = requestedBinary
  ? resolve(requestedBinary)
  : join(packageRoot, 'dist', 'package', target, target.includes('windows') ? 'clara.exe' : 'clara')

await main()

async function main() {
  if (requestedBinary) {
    if (!existsSync(binary)) throw new Error(`No binary at ${binary}`)
  } else {
    const bun = process.env.BUN_BIN?.trim() || 'bun'
    if (!hasCommand(bun)) {
      console.log(`Skipping the package smoke test: \`${bun}\` is not installed.`)
      return
    }
    buildBinary()
  }

  const root = mkdtempSync(join(tmpdir(), 'clara-smoke-'))
  const dataDir = makeDir(join(root, 'data'))
  const [panelPort, localPort, enginePort, webPort] = await freePorts(4)
  const env = {
    ...process.env,
    CLARA_CONFIG_DIR: makeDir(join(root, 'config')),
    CLARA_DATA_DIR: dataDir,
    CLARA_CACHE_DIR: makeDir(join(root, 'cache')),
    CLARA_RUNTIME_FILE: join(root, 'runtime.json'),
    CLARA_PANEL_PORT: String(panelPort),
    CLARA_LOCAL_PORT: String(localPort),
    CLARA_ENGINE_PORT: String(enginePort),
    CLARA_WEB_PORT: String(webPort),
  }

  let started = false
  try {
    expectVersion(env)
    expectStopped(env)

    started = true
    const start = cli(env, ['start'])
    if (start.status !== 0) throw failure(`clara start exited ${start.status}`, env, start)
    console.log('Stack started.')

    const hub = await getJson(`http://127.0.0.1:${panelPort}/health`)
    expect(hub.ok === true, 'the hub health endpoint did not report ok')
    expect(hub.service === 'clara-server', `the hub health endpoint reported ${hub.service}`)

    const web = await getJson(`http://127.0.0.1:${webPort}/healthz`)
    expect(web.ok === true, 'the web health endpoint did not report ok')
    expect(web.service === 'clara-web', `the web health endpoint reported ${web.service}`)

    const panel = await fetch(`http://127.0.0.1:${panelPort}/`)
    expect(panel.status === 200, `the panel returned ${panel.status}`)
    expect(
      (panel.headers.get('content-type') ?? '').includes('text/html'),
      'the panel did not serve HTML'
    )
    expect(/<!doctype html/i.test(await panel.text()), 'the panel shell is not an HTML document')
    console.log('Health endpoints and panel shell are served.')

    const stop = cli(env, ['stop'])
    if (stop.status !== 0) throw failure(`clara stop exited ${stop.status}`, env, stop)
    started = false

    for (const file of ['services.json', 'supervisor.pid', 'engine.pid']) {
      expect(!existsSync(join(dataDir, file)), `${file} was left behind after stop`)
    }
    const runtime = readJson(join(root, 'runtime.json'))
    expect(
      !runtime || runtime.state !== 'running',
      'the hub runtime file still reports a running instance'
    )
    console.log('Stopped cleanly; no pid files remain.')
    console.log('Package smoke test passed.')
  } catch (cause) {
    console.error(`clara smoke: ${cause instanceof Error ? cause.message : String(cause)}`)
    process.exitCode = 1
  } finally {
    if (started) stopQuietly(env)
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // A leftover temporary directory must not hide the smoke result.
    }
  }
}

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value.trim() : undefined
}

function buildBinary() {
  const result = spawnSync(process.execPath, [join(here, 'build-binary.mjs'), '--target', target], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (result.error) throw new Error(`the binary build could not run: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`the binary build exited ${result.status}`)
}

function expectVersion(env) {
  const result = cli(env, ['--version'])
  if (result.status !== 0) throw failure(`clara --version exited ${result.status}`, env, result)
  expect(
    /\d+\.\d+\.\d+/.test(result.stdout),
    `clara --version printed no version: ${result.stdout.trim()}`
  )
  console.log(`Version: ${result.stdout.trim()}`)
}

function expectStopped(env) {
  const result = cli(env, ['status', '--json'])
  if (result.status !== 0) throw failure(`clara status --json exited ${result.status}`, env, result)
  const report = parseJson(result.stdout, 'clara status --json')
  expect(Array.isArray(report.services), 'the status report has no services')
  expect(
    report.services.length === 3,
    `the status report listed ${report.services.length} services`
  )
  for (const service of report.services) {
    expect(service.state === 'stopped', `${service.name} is ${service.state} before start`)
  }
  console.log('Status starts stopped.')
}

function cli(env, args) {
  const result = spawnSync(binary, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 240_000,
  })
  if (result.error)
    throw new Error(`clara ${args.join(' ')} could not run: ${result.error.message}`)
  return result
}

async function getJson(url, attempts = 30) {
  let last = 'no attempt'
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      last = `${url} returned ${response.status}`
    } catch (cause) {
      last = `${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`
    }
    await delay(250)
  }
  throw new Error(`Could not read ${last}`)
}

async function freePorts(count) {
  const ports = new Set()
  while (ports.size < count) {
    ports.add(await freePort())
  }
  return [...ports]
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} printed invalid JSON: ${text.trim()}`)
  }
}

function stopQuietly(env) {
  spawnSync(binary, ['stop'], { cwd: repoRoot, env, stdio: 'ignore', timeout: 30_000 })
}

function makeDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function hostTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `bun-darwin-${arch}`
  if (process.platform === 'win32') return `bun-windows-${arch}`
  return `bun-linux-${arch}`
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function failure(message, env, result) {
  const lines = [message]
  if (result?.stdout?.trim()) lines.push(result.stdout.trimEnd())
  if (result?.stderr?.trim()) lines.push(result.stderr.trimEnd())
  for (const service of ['engine', 'hub', 'web']) {
    const tail = readTail(join(env.CLARA_DATA_DIR, 'logs', `${service}.log`))
    if (tail) lines.push(`--- ${service} ---`, tail)
  }
  return new Error(lines.join('\n'))
}

function readTail(path, lines = 20) {
  try {
    return readFileSync(path, 'utf8').split('\n').slice(-lines).join('\n').trimEnd()
  } catch {
    return ''
  }
}
