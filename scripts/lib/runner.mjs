// Shared runner setup for Clara harness adapter installers.
//
// The runner itself lives in @clara/runner and is imported by each adapter.
// Installers only verify the dependency and write the adapter's local runner
// defaults. A future adapter installer imports these helpers instead of
// reimplementing the check.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function readRunnerConfig(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function ensureRunnerConfig(path, { enabled = true, concurrency = 2 } = {}) {
  const current = readRunnerConfig(path)
  const runner = current.runner && typeof current.runner === 'object' ? current.runner : {}
  const next = {
    ...current,
    runner: {
      enabled: runner.enabled ?? enabled,
      concurrency: runner.concurrency ?? concurrency,
    },
  }
  if (existsSync(path) && JSON.stringify(current) === JSON.stringify(next)) {
    return { path, written: false, runner: next.runner }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return { path, written: true, runner: next.runner }
}

/** True when the adapter can resolve the shared runner package. */
export function runnerAvailable(fromDir) {
  try {
    createRequire(join(fromDir, 'package.json')).resolve('@clara/runner')
    return true
  } catch {
    return false
  }
}
