#!/usr/bin/env node
// Clara documentation site commands.
//
//   pnpm clara docs
//   pnpm clara docs build
//   pnpm clara docs check --json

import { join } from 'node:path'
import { root, runNode, runPnpm } from '../lib/router.mjs'

const DEFAULT_PORT = '5176'
const DEFAULT_HOST = '127.0.0.1'

function help() {
  console.log(`Run or build the Clara documentation site.

Usage:
  pnpm clara docs [dev|build|preview|check|typecheck] [options]

Commands:
  dev        Start the local docs site (default)
  build      Build the production site
  preview    Serve the production build locally
  check      Validate indexes, links, and audience boundaries
  typecheck  Typecheck the Docusaurus site

Options:
  --port <n>   Port for dev or preview (default ${DEFAULT_PORT})
  --host <h>   Host for dev or preview (default ${DEFAULT_HOST})
  --no-open    Do not open the browser for dev
  --json       Machine-readable output for check
  -h, --help   Show this help

Examples:
  pnpm clara docs
  pnpm clara docs --port 5180 --no-open
  pnpm clara docs build
  pnpm clara docs check --json`)
}

function parse(args) {
  const options = { action: 'dev', port: DEFAULT_PORT, host: DEFAULT_HOST, open: true, json: false }
  const actions = new Set(['dev', 'build', 'preview', 'check', 'typecheck'])

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '--port') {
      const value = args[index + 1]
      if (!value) throw new Error('--port needs a value')
      options.port = value
      index += 1
    } else if (arg.startsWith('--port=')) {
      options.port = arg.slice('--port='.length)
    } else if (arg === '--host') {
      const value = args[index + 1]
      if (!value) throw new Error('--host needs a value')
      options.host = value
      index += 1
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length)
    } else if (arg === '--no-open') {
      options.open = false
    } else if (arg === '--json') {
      options.json = true
    } else if (!arg.startsWith('-') && actions.has(arg)) {
      options.action = arg
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return options
}

export function docsArgs(options) {
  const base = ['--filter', '@clara/docs', 'exec', 'docusaurus']
  if (options.action === 'dev') {
    const args = [...base, 'start', '--host', options.host, '--port', options.port]
    if (!options.open) args.push('--no-open')
    return args
  }
  if (options.action === 'preview') {
    return [...base, 'serve', '--host', options.host, '--port', options.port]
  }
  if (options.action === 'build') return [...base, 'build']
  if (options.action === 'typecheck') return [...base, 'typecheck']
  throw new Error(`unknown docs action: ${options.action}`)
}

async function main() {
  const options = parse(process.argv.slice(2))
  if (options.help) {
    help()
    return
  }

  if (options.action === 'check') {
    return runNode(
      join(root, 'tools/cli/src/commands/docs-check.mjs'),
      options.json ? ['--json'] : []
    )
  }

  return runPnpm(docsArgs(options))
}

main().then(
  (code) => {
    process.exitCode = code ?? 0
  },
  (error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
)
