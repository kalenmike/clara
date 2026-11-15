import { main as hubMain } from '@clara/hub-server/main'
import { resolvePaths } from './paths.ts'
import { resolvePorts } from './ports.ts'
import { isServiceName } from './service/specs.ts'
import { runLogs, runRestart, runStart, runStatus, runStop } from './commands/service.ts'
import { runPair } from './commands/pair.ts'
import { runRunnerCommand } from './commands/runner.ts'
import { runSupervisor } from './supervisor/run.ts'
import { applyColorChoice, bold, cyan, dim } from './ui/color.ts'
import { buildId, commit, version } from './version.ts'

type Command = {
  name: string
  summary: string
  usage: string
  options?: { flags: string; description: string }[]
  run: (args: readonly string[]) => Promise<number>
}

export const commands: Command[] = [
  {
    name: 'start',
    summary: 'Start the local stack',
    usage: '[hub|engine|web] [--foreground] [--open]',
    options: [
      { flags: '--foreground', description: 'run the supervisor in this terminal' },
      { flags: '--open', description: 'open the panel in a browser' },
    ],
    run: runStart,
  },
  {
    name: 'stop',
    summary: 'Stop the local stack',
    usage: '[hub|engine|web]',
    run: runStop,
  },
  {
    name: 'restart',
    summary: 'Restart the local stack',
    usage: '[hub|engine|web] [--open]',
    run: runRestart,
  },
  {
    name: 'status',
    summary: 'Show what is running',
    usage: '[hub|engine|web] [--json] [--open]',
    options: [
      { flags: '--json', description: 'machine-readable output' },
      { flags: '--open', description: 'open the panel in a browser' },
    ],
    run: runStatus,
  },
  {
    name: 'ps',
    summary: 'Alias for status',
    usage: '[hub|engine|web] [--json]',
    run: runStatus,
  },
  {
    name: 'logs',
    summary: 'Follow service logs',
    usage: '[hub|engine|web] [--tail <n>] [--no-follow]',
    options: [
      { flags: '--tail <n>', description: 'number of lines to print first (default 80)' },
      { flags: '--no-follow', description: 'print the tail and exit' },
    ],
    run: runLogs,
  },
  {
    name: 'pair',
    summary: 'Print a browser pairing code',
    usage: 'hub [--no-relay] [--no-qr] [--revoke-all|--revoke <id>]',
    run: runPair,
  },
  {
    name: 'runner',
    summary: 'Manage the shared script runner',
    usage:
      'start [--workspace <path>] [--foreground] | stop | status [--json] | logs [--tail <n>] [--no-follow]',
    options: [
      { flags: '--workspace <path>', description: 'directory the runner executes scripts in' },
      { flags: '--foreground', description: 'run the runner in this terminal' },
      { flags: '--json', description: 'machine-readable status' },
      { flags: '--tail <n>', description: 'number of log lines to print first (default 80)' },
      { flags: '--no-follow', description: 'print the log tail and exit' },
    ],
    run: runRunnerCommand,
  },
  {
    name: 'version',
    summary: 'Print the command version',
    usage: '',
    run: async () => {
      console.log(`${version()} (${commit()}, build ${buildId()})`)
      return 0
    },
  },
]

const GLOBAL_OPTIONS = [
  { flags: '-h, --help', description: 'Show help' },
  { flags: '-v, --version', description: 'Print the command version' },
  { flags: '--color <auto|always|never>', description: 'Control colored output' },
  { flags: '--no-color', description: 'Disable colored output' },
]

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = [...argv]
  const color = takeColor(args)
  if (color) applyColorChoice(color)

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(renderHelp(args[1]?.startsWith('-') ? undefined : args[1]))
    return
  }
  if (args[0] === '-v' || args[0] === '--version') {
    console.log(`${version()} (${commit()}, build ${buildId()})`)
    return
  }

  const name = args.shift() ?? ''
  if (name === '__supervise') {
    process.exitCode = await supervise(args)
    return
  }
  if (name === '__serve') {
    process.exitCode = await serve(args[0], args.slice(1))
    return
  }
  if (name === '__hub') {
    await hubMain(args)
    return
  }

  const command = commands.find((item) => item.name === name)
  if (!command) {
    console.error(`unknown command: ${name}`)
    console.log(renderHelp())
    process.exitCode = 2
    return
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(renderHelp(command.name))
    return
  }
  process.exitCode = await command.run(args)
}

async function supervise(args: readonly string[]): Promise<number> {
  let services: string[] = []
  for (const arg of args) {
    if (arg.startsWith('--services=')) services = arg.slice('--services='.length).split(',')
    else if (arg === '--services') continue
    else if (!arg.startsWith('-')) services.push(arg)
  }
  const parsed = services.map((value) => value.trim()).filter((value) => isServiceName(value))
  return runSupervisor({ services: parsed, paths: resolvePaths(), ports: resolvePorts() })
}

async function serve(name: string | undefined, extra: readonly string[] = []): Promise<number> {
  if (name === 'hub') {
    await (await import('./serve/hub.ts')).serveHub()
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  }
  if (name === 'engine') {
    await (await import('./serve/engine.ts')).serveEngine()
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  }
  if (name === 'web') {
    await (await import('./serve/web.ts')).serveWeb()
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  }
  if (name === 'runner') {
    await (await import('./serve/runner.ts')).serveRunner(extra)
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  }
  console.error(`unknown service: ${name ?? '(missing)'}`)
  return 2
}

function takeColor(args: string[]): 'auto' | 'always' | 'never' | undefined {
  let choice: 'auto' | 'always' | 'never' | undefined
  for (let index = args.length - 1; index >= 0; index--) {
    const arg = args[index]
    if (arg === '--no-color') {
      choice = 'never'
      args.splice(index, 1)
    } else if (arg?.startsWith('--color=')) {
      const value = arg.slice('--color='.length)
      if (value === 'auto' || value === 'always' || value === 'never') choice = value
      args.splice(index, 1)
    } else if (arg === '--color') {
      const value = args[index + 1]
      if (value === 'auto' || value === 'always' || value === 'never') {
        choice = value
        args.splice(index, 2)
      }
    }
  }
  return choice
}

export function renderHelp(commandName?: string): string {
  const command = commandName ? commands.find((item) => item.name === commandName) : undefined
  if (commandName && !command) {
    return `unknown command: ${commandName}\n\n${renderHelp()}`
  }

  if (command) {
    const lines = [
      command.summary,
      '',
      'Usage:',
      `  clara ${command.name} ${command.usage}`.trimEnd(),
    ]
    const options = [...(command.options ?? []), ...GLOBAL_OPTIONS]
    const width = Math.max(...options.map((option) => option.flags.length))
    lines.push('', 'Options:')
    for (const option of options)
      lines.push(`  ${option.flags.padEnd(width)}  ${option.description}`)
    return lines.join('\n')
  }

  const width = Math.max(...commands.map((item) => item.name.length))
  const lines = [
    `${bold('Clara')} — run the hub, engine, and web client on this machine.`,
    '',
    'Usage:',
    '  clara <command> [options]',
    '',
    'Commands:',
    ...commands.map((item) => `  ${cyan(item.name.padEnd(width))}  ${item.summary}`),
    '',
    'Options:',
    ...GLOBAL_OPTIONS.map(
      (option) =>
        `  ${option.flags.padEnd(Math.max(...GLOBAL_OPTIONS.map((item) => item.flags.length)))}  ${option.description}`
    ),
    '',
    'Examples:',
    `  ${dim('clara start')}`,
    `  ${dim('clara ps')}`,
    `  ${dim('clara logs -f')}`,
    `  ${dim('clara pair hub')}`,
  ]
  return lines.join('\n')
}
