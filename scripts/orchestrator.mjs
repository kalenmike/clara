#!/usr/bin/env node
// Host and Docker controls for the Clara orchestration service.
//
//   pnpm clara orchestrator start --docker [--build]
//   pnpm clara orchestrator stop --docker
//   pnpm clara orchestrator status

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, runNode } from './lib/router.mjs'

const source = join(root, 'apps', 'orchestrator', 'src', 'index.ts')
const built = join(root, 'apps', 'orchestrator', 'dist', 'index.js')
const args = process.argv.slice(2)

if (existsSync(source)) {
  process.exitCode = runNode(source, args, {
    nodeArgs: ['--experimental-strip-types', '--no-warnings'],
  })
} else if (existsSync(built)) {
  process.exitCode = runNode(built, args)
} else {
  console.error(
    'The orchestration service is not built and its source is missing. Run `pnpm build` first.'
  )
  process.exitCode = 1
}
