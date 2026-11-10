#!/usr/bin/env node
// Host and Docker controls for the Clara orchestration service.
//
//   pnpm clara orchestrator start --docker [--build]
//   pnpm clara orchestrator stop --docker
//   pnpm clara orchestrator status

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, runNode } from './lib/router.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './lib/status.mjs'
import { orchestratorContainerRunning, readDockerToken } from './lib/stack-control.mjs'

const source = join(root, 'apps', 'orchestrator', 'src', 'index.ts')
const built = join(root, 'apps', 'orchestrator', 'dist', 'index.js')
const args = process.argv.slice(2)
const command = args[0] ?? 'help'
const help = args.includes('--help') || args.includes('-h')
const dockerToken =
  !process.env.CLARA_ORCHESTRATION_TOKEN &&
  !process.env.CLARA_ORCHESTRATION_TOKEN_FILE &&
  orchestratorContainerRunning()
    ? readDockerToken()
    : ''
const env = dockerToken ? { CLARA_ORCHESTRATION_TOKEN: dockerToken } : undefined

if (command === 'status' && !help) {
  const [record] = await collectStatus(['orchestrator'])
  if (args.includes('--json')) renderJSON([record])
  else renderStatus([record], { title: 'Clara orchestrator' })
  process.exitCode = statusExitCode([record])
} else if (existsSync(source)) {
  process.exitCode = runNode(source, args, {
    nodeArgs: ['--experimental-strip-types', '--no-warnings'],
    ...(env ? { env } : {}),
  })
} else if (existsSync(built)) {
  process.exitCode = runNode(built, args, { ...(env ? { env } : {}) })
} else {
  console.error(
    'The orchestration service is not built and its source is missing. Run `pnpm build` first.'
  )
  process.exitCode = 1
}
