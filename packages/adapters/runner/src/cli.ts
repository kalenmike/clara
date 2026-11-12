#!/usr/bin/env node
import { runRunner } from './runner.ts'

const HELP = `Clara script runner

Usage: clara-runner [options]

  --config <path>          Runner config (default: ~/.config/clara/runner.json)
  --workspace, -w <path>   Workspace to execute in (default: config, env, or cwd)
  --url <url>              Orchestrator URL (default: config or CLARA_ORCHESTRATION_URL)
  --token <token>          Orchestrator token (default: env or orchestrator.token)
  --id <id>                Stable runner id
  --label <name>           Runner label, repeatable (matches requires.runner)
  --concurrency, -c <n>    Concurrent scripts (default: 2)
  --once                   Claim and run one batch, then exit
  --help, -h               Show this help`

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP)
} else {
  await runRunner(argv).catch((error: unknown) => {
    console.error(`error ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
