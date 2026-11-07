// Resolve and probe the pinned workerd binary before starting Worker tests.
//
// workerd ships a glibc binary. On musl hosts such as Alpine it loads but fails
// to relocate the glibc symbols it needs. The relay suite skips that known
// platform mismatch; every other probe failure stays fatal so a broken install
// is not mistaken for an unsupported host.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root } from './router.mjs'

const relayDirectory = join(root, 'workers', 'relay')

export function resolveWorkerd(env = process.env) {
  const override = env.MINIFLARE_WORKERD_PATH?.trim()
  if (override) return override

  const relayRequire = createRequire(join(relayDirectory, 'package.json'))
  const wrangler = relayRequire.resolve('wrangler')
  const miniflare = createRequire(wrangler).resolve('miniflare')
  return createRequire(miniflare).resolve('workerd/bin/workerd')
}

export function probeWorkerd(binary, run = spawnSync) {
  const result = run(binary, ['--version'], { encoding: 'utf8', timeout: 10_000 })
  if (result.status === 0) return { ok: true }

  const stderr = String(result.stderr ?? '').trim()
  const reason = firstLine(stderr) || result.error?.message || `exited with status ${result.status}`
  const platform = /symbol not found|Error relocating/i.test(stderr)
  return { ok: false, platform, reason }
}

function firstLine(text) {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? ''
}
