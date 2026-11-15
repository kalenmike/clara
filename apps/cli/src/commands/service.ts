import { resolvePaths } from '../paths.ts'
import { resolvePorts, type Ports } from '../ports.ts'
import type { ServiceName } from '../ports.ts'
import {
  defaultServices,
  liveState,
  logTail,
  resolveServices,
  restartStack,
  startStack,
  statusStack,
  stopStack,
  type ServiceStatus,
  type StatusReport,
} from '../service/lifecycle.ts'
import { followLogs } from '../service/logs.ts'
import { isServiceName, SPECS } from '../service/specs.ts'
import { adapterListReport } from './adapters.ts'
import { runnerProcess } from '../state/runner.ts'
import { version } from '../version.ts'
import { bold, cyan, dim, red } from '../ui/color.ts'
import { formatDuration, stateLabel, success, warn } from '../ui/index.ts'
import { startSpinner } from '../ui/spinner.ts'
import { renderTable } from '../ui/table.ts'
import { openUrl } from './open.ts'

type Parsed = {
  services: ServiceName[]
  explicit: boolean
  flags: Set<string>
  options: Map<string, string>
}

const SERVICE_FLAGS = new Set([
  '--foreground',
  '--open',
  '--json',
  '--follow',
  '--no-follow',
  '--force',
])

function parse(args: readonly string[]): Parsed {
  const services: string[] = []
  const flags = new Set<string>()
  const options = new Map<string, string>()

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-')) {
      services.push(
        ...arg
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      )
      continue
    }
    if (arg === '--tail' || arg === '--lines') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} needs a number`)
      options.set('tail', value)
      continue
    }
    if (arg.startsWith('--tail=') || arg.startsWith('--lines=')) {
      options.set('tail', arg.slice(arg.indexOf('=') + 1))
      continue
    }
    if (!SERVICE_FLAGS.has(arg)) throw new Error(`unknown option: ${arg}`)
    flags.add(arg)
  }

  const names: ServiceName[] = []
  for (const value of services) {
    if (value === 'default' || value === 'all') {
      names.push(...defaultServices())
      continue
    }
    if (!isServiceName(value)) {
      throw new Error(`unknown target: ${value} (expected hub, engine, web, or default)`)
    }
    names.push(value)
  }

  return {
    services: resolveServices(names),
    explicit: names.length > 0,
    flags,
    options,
  }
}

export async function runStart(args: readonly string[]): Promise<number> {
  const parsed = parse(args)
  const paths = resolvePaths()
  const ports = resolvePorts()
  const services = parsed.explicit ? parsed.services : defaultServices()

  const running = liveState(paths)
  if (running) {
    console.log(warn('The Clara stack is already running.'))
    await printStatus(paths, ports, services, false)
    if (parsed.flags.has('--open')) openUrl(panelUrl(await statusStack(paths, ports, ['hub'])))
    return 0
  }

  const foreground = parsed.flags.has('--foreground')
  const spinner = foreground ? undefined : startSpinner(`Starting ${services.join(', ')}`)
  const code = await startStack({ paths, ports, services, foreground })
  if (code !== 0) {
    spinner?.fail('The Clara stack did not start.')
    console.error(red('The Clara stack did not start.'))
    for (const name of services) {
      const tail = logTail(paths, name, 15)
      if (tail) console.error(dim(`--- ${name} ---\n${tail}`))
    }
    return code
  }
  spinner?.succeed('Clara is running')

  const report = await statusStack(paths, ports, services)
  printSummary(report.services)
  if (parsed.flags.has('--open')) openUrl(panelUrl(report))
  return 0
}

export async function runStop(args: readonly string[]): Promise<number> {
  const parsed = parse(args)
  const paths = resolvePaths()
  const target = parsed.explicit && parsed.services.length === 1 ? parsed.services[0] : undefined
  const spinner = startSpinner('Stopping the Clara stack')
  const code = await stopStack(paths, target)
  if (code === 0) {
    spinner.succeed('Stopped the Clara stack.')
  } else {
    spinner.fail('The Clara stack did not stop cleanly.')
  }
  return code
}

export async function runRestart(args: readonly string[]): Promise<number> {
  const parsed = parse(args)
  const paths = resolvePaths()
  const ports = resolvePorts()
  const code = await restartStack(paths, ports, parsed.explicit ? parsed.services : [])
  if (code !== 0) {
    console.error(red('The Clara stack did not restart.'))
    return code
  }
  const report = await statusStack(
    paths,
    ports,
    parsed.explicit ? parsed.services : defaultServices()
  )
  printSummary(report.services)
  if (parsed.flags.has('--open')) openUrl(panelUrl(report))
  return 0
}

export async function runStatus(args: readonly string[]): Promise<number> {
  const parsed = parse(args)
  const paths = resolvePaths()
  const ports = resolvePorts()
  const services = parsed.explicit ? parsed.services : defaultServices()
  const report = await statusStack(paths, ports, services)

  const adapters = adapterListReport(paths)
  const runner = runnerProcess(paths)

  if (parsed.flags.has('--json')) {
    console.log(JSON.stringify({ ...report, adapters, runner }, null, 2))
    return 0
  }

  await printStatus(paths, ports, services, true, report)
  printExtras(adapters, runner)
  if (parsed.flags.has('--open')) openUrl(panelUrl(report))
  return 0
}

export async function runLogs(args: readonly string[]): Promise<number> {
  const parsed = parse(args)
  const paths = resolvePaths()
  const services = parsed.explicit ? parsed.services : defaultServices()
  const tail = Number.parseInt(parsed.options.get('tail') ?? '80', 10)
  return followLogs({
    paths,
    services,
    lines: Number.isInteger(tail) && tail > 0 ? tail : 80,
    follow: !parsed.flags.has('--no-follow'),
  })
}

async function printStatus(
  paths: ReturnType<typeof resolvePaths>,
  ports: Ports,
  services: readonly ServiceName[],
  header: boolean,
  known?: StatusReport
): Promise<void> {
  const list = known?.services ?? (await statusStack(paths, ports, services)).services
  if (header) {
    const uptime = Math.max(0, ...list.map((service) => service.uptimeMs ?? 0))
    const suffix = uptime > 0 ? ` · up ${formatDuration(uptime)}` : ''
    console.log(bold(`Clara ${version()} · local${suffix}`))
    console.log('')
  }
  console.log(
    renderTable(list, [
      { header: 'SERVICE', value: (service) => bold(service.name) },
      { header: 'STATE', value: (service) => stateLabel(service.state) },
      { header: 'ENDPOINT', value: (service) => cyan(service.url) },
      {
        header: 'PID',
        value: (service) => (service.pid ? String(service.pid) : '-'),
        align: 'right',
      },
      {
        header: 'UPTIME',
        value: (service) => (service.uptimeMs ? formatDuration(service.uptimeMs) : '-'),
        align: 'right',
      },
    ])
  )
}

function printExtras(
  adapters: ReturnType<typeof adapterListReport>,
  runner: ReturnType<typeof runnerProcess>
): void {
  console.log('')
  if (adapters.length === 0) {
    console.log(dim('  adapters  none installed'))
  } else {
    console.log(`  ${bold('ADAPTERS')}`)
    console.log(
      renderTable(adapters, [
        { header: 'KIND', value: (entry) => bold(entry.kind) },
        { header: 'VERSION', value: (entry) => entry.version },
        { header: 'PLATFORM', value: (entry) => entry.platform },
        {
          header: 'STATE',
          value: (entry) =>
            entry.state === 'running'
              ? stateLabel('running')
              : entry.state === 'stopped'
                ? stateLabel('stopped')
                : dim('unknown'),
        },
      ])
    )
  }
  console.log(
    `  ${dim('runner')}    ${runner.running ? stateLabel('running') : stateLabel('stopped')}${runner.pid ? dim(` (${runner.pid})`) : ''}`
  )
}

function printSummary(services: readonly ServiceStatus[]): void {
  const hub = services.find((service) => service.name === 'hub')
  const web = services.find((service) => service.name === 'web')
  const engine = services.find((service) => service.name === 'engine')
  console.log('')
  console.log(success(`Clara ${version()} is running`))
  console.log('')
  if (hub) console.log(`  panel   ${cyan(hub.url)}`)
  if (web) console.log(`  web     ${cyan(web.url)}`)
  if (engine) console.log(`  engine  ${cyan(engine.url)}`)
  console.log('')
  console.log(dim('  logs   clara logs -f'))
  console.log(dim('  pair   clara pair hub'))
  console.log(dim('  stop   clara stop'))
}

function panelUrl(report: { services: ServiceStatus[] }): string {
  const hub = report.services.find((service) => service.name === 'hub')
  return hub ? `${hub.url}/` : `http://127.0.0.1:${SPECS.hub.port(resolvePorts())}/`
}
