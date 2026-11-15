import { isCompiled } from '../self.ts'
import { liveState, restartStack, statusStack } from '../service/lifecycle.ts'
import { resolvePaths } from '../paths.ts'
import { resolvePorts } from '../ports.ts'
import { runSetup as setup } from '../setup/setup.ts'
import { applyLocalArchive, applyUpdate, checkForUpdate, rollback } from '../release/update.ts'
import { detectService } from '../service-manager/index.ts'
import { detectRole } from '../state/role.ts'
import { cyan, dim } from '../ui/color.ts'
import { failure, success, warn } from '../ui/index.ts'
import { promptLine, promptSecret, readStdin } from '../ui/prompt.ts'
import { startSpinner } from '../ui/spinner.ts'
import { version } from '../version.ts'
import { parseFlags, type Flags } from './flags.ts'

export async function runSetupCommand(args: readonly string[]): Promise<number> {
  const parsed = parseFlags(args)
  const paths = resolvePaths()
  const ports = resolvePorts()
  const interactive = !parsed.flags.has('non-interactive') && process.stdin.isTTY
  if (detectRole(paths) === 'adapter') {
    console.log(
      warn(
        'This machine is currently an adapter host. Setup will create and start the Clara services here.'
      )
    )
  }

  let username = parsed.options.get('username')
  if (!username && interactive) username = await promptLine('Hub owner username', 'admin')

  let password: string | undefined
  if (parsed.flags.has('password-stdin')) password = (await readStdin()).split('\n')[0]
  else if (parsed.options.has('password')) {
    const { readFileSync } = await import('node:fs')
    password = readFileSync(parsed.options.get('password')!, 'utf8').trim()
  } else if (username && interactive) {
    const first = await promptSecret('Hub owner password: ')
    const second = await promptSecret('Confirm password: ')
    if (first !== second) {
      console.error(failure('The passwords did not match.'))
      return 1
    }
    password = first
  }

  const wantsService = !parsed.flags.has('no-service')
  const wantStart = !parsed.flags.has('no-start')
  if (interactive && wantsService && detectService() === 'none') {
    console.log(
      warn('No supported login service on this host; start the stack with `clara start`.')
    )
  }

  const result = await setup({
    paths,
    ports,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    installService: wantsService,
    start: wantStart,
  })

  for (const step of result.steps) {
    const line =
      step.status === 'done'
        ? success(step.name)
        : step.status === 'skipped'
          ? warn(step.name)
          : failure(step.name)
    console.log(`${line}${step.detail ? dim(` — ${step.detail}`) : ''}`)
  }

  if (result.code === 0 && wantStart) {
    const report = await statusStack(paths, ports, ['hub', 'engine', 'web'])
    const hub = report.services.find((service) => service.name === 'hub')
    const web = report.services.find((service) => service.name === 'web')
    console.log('')
    console.log(success(`Clara ${version()} is ready`))
    if (hub) console.log(`  panel   ${cyan(`${hub.url}/`)}`)
    if (web) console.log(`  web     ${cyan(`${web.url}/`)}`)
    console.log('')
    console.log(dim('  pair a client    clara pair hub'))
    console.log(dim('  add an adapter   clara adapter search'))
  }
  return result.code
}

export async function runUpdateCommand(args: readonly string[]): Promise<number> {
  const parsed = parseFlags(args)
  const paths = resolvePaths()
  const ports = resolvePorts()
  const wasRunning = Boolean(liveState(paths))

  if (parsed.flags.has('rollback')) {
    const result = rollback(paths)
    console.log(success(`Rolled back to ${result.version}.`))
    if (wasRunning) await restartStack(paths, ports, [])
    return 0
  }

  if (parsed.options.has('file')) return installFromFile(parsed, wasRunning)

  let check
  try {
    check = await checkForUpdate({
      paths,
      ...(parsed.options.has('base-url') ? { baseUrl: parsed.options.get('base-url') } : {}),
    })
  } catch (cause) {
    console.error(failure(cause instanceof Error ? cause.message : String(cause)))
    return 1
  }

  if (parsed.flags.has('check')) {
    console.log(`current   ${check.current}`)
    console.log(`latest    ${check.manifest.version}`)
    console.log(
      check.available
        ? success('An update is available. Run `clara update`.')
        : dim('Clara is up to date.')
    )
    return 0
  }

  if (!check.available) {
    console.log(success(`Clara ${check.current} is up to date.`))
    return 0
  }
  if (!isCompiled() && !parsed.flags.has('force')) {
    console.error(
      failure(
        'This checkout is not a packaged install. Use the packaged command or pass --force to update anyway.'
      )
    )
    return 1
  }

  const spinner = startSpinner(`Downloading Clara ${check.manifest.version}`)
  try {
    const result = await applyUpdate({
      paths,
      check,
      onProgress: (received, total) => {
        if (total > 0) {
          const percent = Math.round((received / total) * 100)
          spinner.update(`Downloading Clara ${check.manifest.version} (${percent}%)`)
        }
      },
    })
    spinner.succeed(`Installed Clara ${result.version}.`)
    if (wasRunning && !parsed.flags.has('no-restart')) {
      await restartStack(paths, ports, [])
      console.log(success('Restarted the Clara stack.'))
    }
    return 0
  } catch (cause) {
    spinner.fail(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

async function installFromFile(parsed: Flags, wasRunning: boolean): Promise<number> {
  const paths = resolvePaths()
  const ports = resolvePorts()
  const file = parsed.options.get('file')
  const release = parsed.options.get('version')
  if (!file || !release) {
    console.error(failure('--file needs --version.'))
    return 1
  }
  const result = await applyLocalArchive({ paths, archive: file, version: release })
  console.log(success(`Installed Clara ${result.version} → ${result.binary}`))
  if (wasRunning && !parsed.flags.has('no-restart')) await restartStack(paths, ports, [])
  return 0
}
