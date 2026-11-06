#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PANEL_PORT = 8790
const START_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 250

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = readPort(process.env.CLARA_PANEL_PORT)
const url = `http://127.0.0.1:${port}/`
const statusUrl = `${url}panel/api/v1/status`

if (process.env.CLARA_PANEL_DISABLED === '1') {
  fail('The panel is disabled by CLARA_PANEL_DISABLED=1. Unset it and try again.')
}

if (await isPanelUp()) {
  openPanel()
  process.exit(0)
}

if (await isPortBusy()) {
  fail(
    `Port ${port} is already in use on 127.0.0.1, but it did not answer as the agent panel. ` +
      'The agent may still be starting; wait a moment and try again, or set CLARA_PANEL_PORT.'
  )
}

const entry = join(root, 'apps/server/dist/index.js')
if (!existsSync(entry) || !existsSync(join(root, 'apps/server/dist/panel/index.html'))) {
  fail('The agent or its panel is not built. Run `pnpm build` first.')
}

console.log(`Starting the Clara home agent in ${root}`)
const child = spawn(process.execPath, [entry], { cwd: root, stdio: 'inherit' })

const failure = await waitForPanel(child)
if (failure) {
  child.kill('SIGTERM')
  fail(failure)
}

openPanel()
child.on('exit', (code) => process.exit(code ?? 0))

async function waitForPanel(agent) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (agent.exitCode !== null || agent.signalCode !== null) {
      return `The agent exited before its panel was ready (${agent.exitCode ?? agent.signalCode}).`
    }
    if (await isPanelUp()) return undefined
    await sleep(POLL_INTERVAL_MS)
  }
  return `The panel did not answer at ${url} within ${START_TIMEOUT_MS / 1000} seconds.`
}

async function isPanelUp() {
  try {
    const response = await fetch(statusUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return false
    const body = await response.json()
    return typeof body === 'object' && body !== null && typeof body.apiVersion === 'number'
  } catch {
    return false
  }
}

function isPortBusy() {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (busy) => {
      socket.destroy()
      resolvePromise(busy)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

function openPanel() {
  console.log(`Panel: ${url}`)
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    const opener = spawn(command, args, { stdio: 'ignore', detached: true })
    opener.on('error', () => console.warn(`Could not open a browser. Visit ${url}`))
    opener.unref()
  } catch {
    console.warn(`Could not open a browser. Visit ${url}`)
  }
}

function readPort(value) {
  const text = value?.trim()
  if (!text) return DEFAULT_PANEL_PORT
  const parsed = Number.parseInt(text, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fail(`Invalid CLARA_PANEL_PORT: ${text}`)
  }
  return parsed
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function fail(message) {
  console.error(`clara control: ${message}`)
  process.exit(1)
}
