// Durable state for the rebuild lifecycle.
//
// The snapshot is the contract between `status` and the later `restart` and
// `health` commands. It records what was running before the rebuild so the
// pipeline can restore exactly that set, and it never stores credentials.

import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const STATE_SCHEMA = 1
export const STATE_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function dataDir(env = process.env) {
  const configured = env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export function rebuildDir(env = process.env) {
  return join(dataDir(env), 'rebuild')
}

export function statePath(env = process.env) {
  return join(rebuildDir(env), 'setup.json')
}

export function journalPath(env = process.env) {
  return join(rebuildDir(env), 'restart.json')
}

export function logPath(env = process.env) {
  return join(rebuildDir(env), 'rebuild.log')
}

export function ensureRebuildDir(env = process.env) {
  const dir = rebuildDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on platforms without POSIX modes.
  }
}

export function readState(path = statePath()) {
  const state = readJson(path)
  if (!state || typeof state !== 'object' || state.schema !== STATE_SCHEMA) return undefined
  return state
}

export function writeState(state, path = statePath()) {
  writeJson(path, state)
}

export function readJournal(path = journalPath()) {
  const journal = readJson(path)
  if (!journal || typeof journal !== 'object') return undefined
  return journal
}

export function writeJournal(journal, path = journalPath()) {
  writeJson(path, journal)
}

export function appendLog(env = process.env, message) {
  ensureRebuildDir(env)
  const line = `[${new Date().toISOString()}] ${message}\n`
  appendFileSync(logPath(env), line, { mode: 0o600 })
}

export function isSnapshotStale(state, now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS) {
  const created = Date.parse(state?.createdAt ?? '')
  if (!Number.isFinite(created)) return true
  return now - created > maxAgeMs
}

/** Keep the end of long command output for a JSON result. */
export function tail(text, maxChars = 4000) {
  const value = String(text ?? '')
  if (value.length <= maxChars) return value
  return `…${value.slice(value.length - maxChars)}`
}
