#!/usr/bin/env node
import { helpText, parseOptions, UsageError } from './args.ts'
import { adapterLogs, install, startAdapter, status, stopAdapter, uninstall } from './install.ts'
import { runRunner } from './runner.ts'

function printResult(result: {
  actions: string[]
  warnings: string[]
  genericMcp?: string
  json: boolean
}): void {
  if (result.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  for (const action of result.actions) console.log(action)
  for (const warning of result.warnings) console.error(`warn ${warning}`)
  if (result.genericMcp) {
    console.log('')
    console.log('Generic MCP client config:')
    console.log(result.genericMcp)
  }
}

function age(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1_000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === 'runner') {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(helpText())
      return
    }
    await runRunner(argv.slice(1))
    return
  }

  const options = parseOptions(argv)
  if (options.help || options.command === 'help' || options.command === '') {
    console.log(helpText())
    return
  }

  if (options.command === 'start' || options.command === 'stop' || options.command === 'logs') {
    const selected = options.harnesses.length ? options.harnesses : (['opencode'] as const)
    if (!selected.includes('opencode')) {
      throw new UsageError('the adapter lifecycle commands currently support --opencode')
    }
    if (options.command === 'start') {
      for (const action of startAdapter()) console.log(action)
      return
    }
    if (options.command === 'stop') {
      for (const action of stopAdapter()) console.log(action)
      return
    }
    console.log(adapterLogs(options.lines ?? 80))
    return
  }

  if (options.command === 'install') {
    const result = await install(options)
    printResult({ ...result, json: options.json })
    if (result.genericMcp && !options.json) {
      console.log('')
      console.log('No harness was selected, so no harness config was written.')
    }
    return
  }

  if (options.command === 'uninstall') {
    const result = uninstall(options)
    printResult({ ...result, json: options.json })
    return
  }

  if (options.command === 'status') {
    const report = await status()
    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      const harnesses = Object.entries(report.harnesses)
      console.log(
        `harnesses: ${harnesses.length ? harnesses.map(([name]) => name).join(', ') : 'none'}`
      )
      for (const [name, value] of harnesses) {
        console.log(
          `  ${name}: plugin ${value.plugin}, agent ${value.agent}, config ${value.config ? 'yes' : 'no'}, mcp ${value.mcp ? 'yes' : 'no'}`
        )
      }
      if (report.adapter) {
        console.log(
          `adapter: ${report.adapter.present ? 'configured' : 'missing'} (${report.adapter.config})`
        )
        console.log(
          `  process: ${report.adapter.running ? `running${report.adapter.pid ? ` (pid ${report.adapter.pid})` : ''}` : 'stopped'}`
        )
        console.log(`  log: ${report.adapter.log}`)
        if (report.adapter.harnessId) console.log(`  harness: ${report.adapter.harnessId}`)
        if (report.adapter.wsUrl) console.log(`  ws: ${report.adapter.wsUrl}`)
        if (report.adapter.opencodeUrl) console.log(`  opencode: ${report.adapter.opencodeUrl}`)
        if (report.adapter.live) {
          const live = report.adapter.live
          if (report.adapter.running) {
            console.log(`  hub: ${live.hub.status} (${live.hub.url})`)
            console.log(
              `  link: ${live.hub.authenticated ? 'authenticated' : live.hub.connected ? 'handshake complete' : 'not authenticated'}` +
                (live.hub.lastFrameAt ? `, last frame ${age(live.hub.lastFrameAt)}` : '')
            )
            if (live.hub.lastError) console.log(`  hub error: ${live.hub.lastError}`)
            console.log(
              `  health: ${live.opencode.reachable ? 'reachable' : 'unreachable'} (${live.opencode.code ?? 'unknown'}` +
                `${live.opencode.version ? `, ${live.opencode.version}` : ''}` +
                `${live.opencode.checkedAt ? `, checked ${age(live.opencode.checkedAt)}` : ''})`
            )
            if (live.opencode.message) console.log(`  opencode error: ${live.opencode.message}`)
          } else {
            console.log(`  live: stale (last ${live.hub.status}, updated ${age(live.updatedAt)})`)
          }
        }
      } else {
        console.log('adapter: not installed')
      }
      if (report.runner) {
        console.log(
          `runner: ${report.runner.present ? 'configured' : 'missing'} (${report.runner.service}, ${report.runner.active})`
        )
        console.log(`  config: ${report.runner.config}`)
      } else {
        console.log('runner: not installed')
      }
      console.log(`orchestrator: ${report.orchestrator}`)
    }
    if (report.orchestrator !== 'running') process.exitCode = 1
    return
  }

  throw new UsageError(`unknown command: ${options.command}`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`error ${error.message}`)
    console.error('')
    console.error(helpText())
  } else {
    console.error(`error ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exitCode = 1
})
