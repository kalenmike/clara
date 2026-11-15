// A tiny command tree for the repository's developer tools.
//
// Each entry point (src/main.mjs, src/task.mjs) passes a tree to `main`, which
// resolves the command path, renders help, and forwards arguments to one
// existing implementation. There is deliberately no option parser here: leaf
// commands own their arguments.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

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

function renderRows(lines, label, rows) {
  const width = Math.max(...rows.map((row) => row.name.length))
  lines.push('', `${label}:`)
  for (const row of rows) lines.push(`  ${row.name.padEnd(width)}  ${row.description}`)
}

/**
 * Render help for a command node. Kept pure so it is easy to test.
 *
 * `tree.bin` sets the executable name shown in usage lines (defaults to
 * `tree.name`). A node may list several `usage` forms; `sections` renders extra
 * aligned tables such as targets alongside `Commands` and `Options`.
 */
export function renderHelp(tree, path = []) {
  const node = commandAt(tree, path)
  const name = [tree.bin ?? tree.name, ...path].join(' ')
  const lines = [node.summary, '', 'Usage:']

  if (node.commands?.length) {
    lines.push(`  ${name} <command> [options]`)
  } else {
    const usages = node.usage ? [].concat(node.usage) : ['']
    for (const usage of usages) lines.push(`  ${[name, usage].filter(Boolean).join(' ')}`)
  }

  if (node.commands?.length) {
    const width = Math.max(...node.commands.map((command) => command.name.length))
    const groups = []
    for (const command of node.commands) {
      const label = command.group ?? 'Commands'
      let group = groups.find((entry) => entry.label === label)
      if (!group) {
        group = { label, commands: [] }
        groups.push(group)
      }
      group.commands.push(command)
    }
    for (const group of groups) {
      lines.push('', `${group.label}:`)
      for (const command of group.commands) {
        lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`)
      }
    }
  }

  for (const section of node.sections ?? []) {
    renderRows(lines, section.label, section.items)
  }

  const options = [...(node.options ?? [])]
  if (!options.some((option) => option.flags.includes('--help'))) {
    options.push({ flags: '-h, --help', description: 'Show help' })
  }
  if (path.length === 0 && tree.version !== false) {
    options.push({ flags: '-v, --version', description: 'Show the repository version' })
  }

  if (options.length > 0) {
    renderRows(
      lines,
      'Options',
      options.map((option) => ({ name: option.flags, description: option.description }))
    )
  }

  if (node.examples?.length) {
    lines.push('', 'Examples:')
    for (const example of node.examples) lines.push(`  ${example}`)
  }

  return lines.join('\n')
}

/**
 * Render help for a standalone script that exposes several `clara` usages, such
 * as a per-service control script invoked by the lifecycle commands.
 */
export function renderCommandHelp(node) {
  return renderHelp({
    name: 'clara',
    bin: 'clara',
    version: false,
    ...node,
  })
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

/** Entry point shared by src/main.mjs and src/task.mjs. */
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
