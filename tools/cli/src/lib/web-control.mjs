import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, run } from './router.mjs'
import { positiveInt, probe } from './server-control.mjs'

export function composeFile(repoRoot = root) {
  return join(repoRoot, 'infra', 'docker', 'web.compose.yml')
}

export function envFile(repoRoot = root) {
  return join(repoRoot, 'infra', 'docker', '.env')
}

export function compose(args, repoRoot = root) {
  return run('docker', composeArgs(args, repoRoot), { cwd: repoRoot })
}

/** Load infra/docker/.env so `clara web ... --docker` matches the documented setup. */
export function composeArgs(args, repoRoot = root) {
  const file = envFile(repoRoot)
  const envArgs = existsSync(file) ? ['--env-file', file] : []
  return ['compose', ...envArgs, '-f', composeFile(repoRoot), ...args]
}

export function webPort(env = process.env) {
  return positiveInt(env.CLARA_WEB_PORT, 8080)
}

export function webURL(env = process.env) {
  return `http://127.0.0.1:${webPort(env)}`
}

export async function waitForWeb(timeoutMs = 90_000, env = process.env) {
  const deadline = Date.now() + timeoutMs
  const url = `${webURL(env)}/healthz`
  while (Date.now() < deadline) {
    const result = await probe(url)
    if (result.ok && result.body?.service === 'clara-web') return result.body
    await sleep(300)
  }
  return undefined
}

export function webRunningInCompose(repoRoot = root) {
  const result = spawnSync('docker', composeArgs(['ps', '-q', 'web'], repoRoot), {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return result.status === 0 && result.stdout.trim().length > 0
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
