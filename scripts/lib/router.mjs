// A tiny command tree for the repository's developer tools.
//
// Each entry point (scripts/clara.mjs, scripts/task.mjs) passes a tree to
// `main`, which resolves the command path, renders help, and forwards arguments
// to one existing implementation. There is deliberately no option parser here:
// leaf commands own their arguments.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

export class CliError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

export function fail(message, code = 1) {
  throw new CliError(message, code)
}

/** Run a command with inherited stdio and return its exit code. */
export function run(command, args, { cwd = root, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`error: ${result.error.message}`)
    return 1
  }
  if (result.signal) {
    console.error(`error: ${command} stopped by ${result.signal}`)
    return 1
  }
  return result.status ?? 1
}

export function runPnpm(args, options = {}) {
  return run(PNPM, args, options)
}

export function runNode(script, args, { nodeArgs = [], ...options } = {}) {
  return run(process.execPath, [...nodeArgs, script, ...args], options)
}

export function readVersion() {
  const packageFile = join(root, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'))
  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
}

/** Resolve the longest command path before the first argument. */
export function resolveCommand(tree, argv) {
  const args = [...argv]
  let explicitHelp = false

  if (args[0] === 'help') {
    explicitHelp = true
    args.shift()
  }

  const help = explicitHelp || args.includes('--help') || args.includes('-h')
  let node = tree
  const path = []

  while (args.length > 0 && !args[0].startsWith('-') && node.commands?.length) {
    const token = args.shift()
    const child = node.commands.find((command) => command.name === token)
    if (!child) return { error: { node, path, token }, node, path, args, help }
    node = child
    path.push(token)
  }

  return { node, path, args, help, explicitHelp }
}

/** Render help for a command node. Kept pure so it is easy to test. */
export function renderHelp(tree, path = []) {
  const node = commandAt(tree, path)
  const name = [tree.name, ...path].join(' ')
  const lines = [node.summary, '', 'Usage:']

  if (node.commands?.length) {
    lines.push(`  pnpm ${name} <command> [options]`)
  } else if (node.usage) {
    lines.push(`  pnpm ${name} ${node.usage}`)
  } else {
    lines.push(`  pnpm ${name}`)
  }

  if (node.commands?.length) {
    const width = Math.max(...node.commands.map((command) => command.name.length))
    lines.push('', 'Commands:')
    for (const command of node.commands) {
      lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`)
    }
  }

  const options = [...(node.options ?? [])]
  if (!options.some((option) => option.flags.includes('--help'))) {
    options.push({ flags: '-h, --help', description: 'Show help' })
  }
  if (path.length === 0) {
    options.push({ flags: '-v, --version', description: 'Show the repository version' })
  }

  if (options.length > 0) {
    const width = Math.max(...options.map((option) => option.flags.length))
    lines.push('', 'Options:')
    for (const option of options) {
      lines.push(`  ${option.flags.padEnd(width)}  ${option.description}`)
    }
  }

  if (node.examples?.length) {
    lines.push('', 'Examples:')
    for (const example of node.examples) lines.push(`  ${example}`)
  }

  return lines.join('\n')
}

function commandAt(tree, path) {
  let node = tree
  for (const token of path) {
    const child = node.commands?.find((command) => command.name === token)
    if (!child) throw new Error(`Unknown command path: ${path.join(' ')}`)
    node = child
  }
  return node
}

/** Entry point shared by scripts/clara.mjs and scripts/task.mjs. */
export async function main(tree, argv = process.argv.slice(2)) {
  try {
    if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
      console.log(readVersion())
      return
    }

    const resolved = resolveCommand(tree, argv)
    if (resolved.error) {
      console.error(`Unknown command: ${resolved.error.token}`)
      console.log(renderHelp(tree, resolved.path))
      process.exitCode = 2
      return
    }

    const { node, path, args, help, explicitHelp } = resolved

    if (help && !(node.passthroughHelp && args.length > 0 && !explicitHelp)) {
      console.log(renderHelp(tree, path))
      process.exitCode = 0
      return
    }

    if (!node.run) {
      console.log(renderHelp(tree, path))
      process.exitCode = args.length === 0 ? 0 : 2
      return
    }

    const code = await node.run(args, { path, tree })
    process.exitCode = code ?? 0
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`error: ${error.message}`)
      process.exitCode = error.code
      return
    }
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
