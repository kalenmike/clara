#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { installRunner, runnerStatus, uninstallRunner } from './install.ts'
import { runRunner } from './runner.ts'

const HELP = `Clara shared runner installer

Usage:
  clara-runner-install install [--no-service] [--workspace <path>] [--url <url>]
  clara-runner-install uninstall
  clara-runner-install status
  clara-runner-install runner [--config <path>] [--once]

Harnesses own their own installers. This command only manages the one shared
script runner for a workspace.
`

async function main(argv: string[]): Promise<void> {
  const [command = 'help', ...args] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP)
    return
  }
  if (command === 'runner') {
    await runRunner(args)
    return
  }
  if (command === 'install') {
    const { values } = parseArgs({
      args,
      options: {
        runner: { type: 'boolean', default: false },
        'no-service': { type: 'boolean', default: false },
        workspace: { type: 'string' },
        url: { type: 'string' },
        concurrency: { type: 'string' },
        label: { type: 'string', multiple: true, default: [] },
        'dry-run': { type: 'boolean', default: false },
      },
    })
    const result = installRunner({
      ...(values.workspace ? { workspace: values.workspace } : {}),
      ...(values.url ? { url: values.url } : {}),
      ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
      labels: values.label,
      noService: values['no-service'],
      dryRun: values['dry-run'],
      explicit: true,
    })
    for (const action of result.actions) console.log(action)
    for (const warning of result.warnings) console.error(`warn ${warning}`)
    return
  }
  if (command === 'uninstall') {
    for (const action of uninstallRunner()) console.log(action)
    return
  }
  if (command === 'status') {
    const status = runnerStatus()
    if (!status) {
      console.log('runner: not installed')
      return
    }
    console.log(
      `runner: ${status.present ? 'configured' : 'missing'} (${status.service}, ${status.active})`
    )
    console.log(`  config: ${status.config}`)
    return
  }
  throw new Error(`unknown command: ${command}`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
