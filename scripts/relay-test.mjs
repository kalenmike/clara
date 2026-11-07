#!/usr/bin/env node
// Run the relay Worker tests only when the pinned workerd can execute.
//
// workerd cannot run on musl hosts such as Alpine. `pnpm check` and
// `pnpm task session close` must still work there, so a glibc loader mismatch
// skips the suite with a warning. Set CLARA_REQUIRE_WORKERD=1 on supported
// hosts to make that skip a failure.

import { join } from 'node:path'
import { runPnpm, root } from './lib/router.mjs'
import { probeWorkerd, resolveWorkerd } from './lib/workerd.mjs'

const relayDirectory = join(root, 'workers', 'relay')
const override = Boolean(process.env.MINIFLARE_WORKERD_PATH?.trim())
const strict = process.env.CLARA_REQUIRE_WORKERD === '1'

let binary
try {
  binary = resolveWorkerd()
} catch (error) {
  console.error(
    `Could not resolve the workerd binary: ${error instanceof Error ? error.message : String(error)}`
  )
  console.error('Run `pnpm install` in this worktree and try again.')
  process.exit(1)
}

const status = probeWorkerd(binary)
if (status.ok) {
  process.exitCode = runPnpm(['exec', 'vitest', 'run'], { cwd: relayDirectory })
} else if (!status.platform) {
  console.error(`workerd failed to start: ${status.reason}`)
  process.exitCode = 1
} else if (strict || override) {
  console.error(`workerd cannot run on this platform: ${status.reason}`)
  if (strict) console.error('CLARA_REQUIRE_WORKERD=1 requires the Worker tests to run here.')
  if (override) console.error('MINIFLARE_WORKERD_PATH points at a binary that cannot run here.')
  process.exitCode = 1
} else {
  console.warn('')
  console.warn('Skipping @clara/relay tests: workerd cannot run on this platform.')
  console.warn(`  ${status.reason}`)
  console.warn('')
  console.warn('workerd is a glibc binary and does not run on musl hosts such as Alpine.')
  console.warn('Run the Worker suite on Debian/Ubuntu or in a glibc container, and set')
  console.warn('CLARA_REQUIRE_WORKERD=1 there to make this skip a failure.')
  console.warn('')
  process.exitCode = 0
}
