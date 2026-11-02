#!/usr/bin/env node
// Clara ledger CLI.
//
// Invoke the ledger tools directly, without an OpenCode agent. This is for
// testing and for answering "what would the agent have gotten back?" — the
// same tool definitions, the same role checks, the same ledger.
//
//   pnpm clara:ledger list
//   pnpm clara:ledger run clara_inbox
//   pnpm clara:ledger run clara_ask '{"question":"what is in flight?"}'
//
// The actor is derived from --agent exactly as it is inside OpenCode:
// clara -> human, 001 -> ai_1, 002 -> ai_2, 003 -> ai_3, judge -> ai_0.

import { readFileSync } from 'node:fs'
import { DEFAULT_DB_PATH, getDb } from './db.ts'
import { AGENT_ACTORS, createTools, toolId, type ClaraTool } from './index.ts'

type Options = {
  command: string
  args: string[]
  agent: string
  db?: string
  json: boolean
}

function fail(message: string): never {
  console.error(`error ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  let agent = 'clara'
  let db: string | undefined
  let json = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') return { command: 'help', args: [], agent, db, json }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--agent') {
      agent = argv[++index] ?? fail('--agent needs a value')
      continue
    }
    if (arg.startsWith('--agent=')) {
      agent = arg.slice('--agent='.length)
      continue
    }
    if (arg === '--db') {
      db = argv[++index] ?? fail('--db needs a value')
      continue
    }
    if (arg.startsWith('--db=')) {
      db = arg.slice('--db='.length)
      continue
    }
    if (arg.startsWith('-') && arg !== '-') fail(`unknown option ${arg}`)

    positional.push(arg)
  }

  const [command = 'help', ...args] = positional
  return { command, args, agent, db, json }
}

function resolveTool(tools: ClaraTool[], requested: string): ClaraTool {
  const bare = requested.replace(/^clara[._]/, '')
  const tool = tools.find((candidate) => candidate.name === bare)
  if (!tool) {
    const available = tools.map((candidate) => toolId(candidate.name)).join(', ')
    fail(`unknown tool "${requested}". Available: ${available}`)
  }
  return tool
}

function readInput(source: string | undefined): any {
  if (source === undefined) return {}
  if (source === '-') return parseJson(readFileSync(0, 'utf8'), 'stdin')
  if (source.startsWith('@')) return parseJson(readFileSync(source.slice(1), 'utf8'), source)
  return parseJson(source, 'argument')
}

function parseJson(text: string, source: string): any {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON from ${source}: ${(error as Error).message}`)
  }
}

function render(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === undefined) return ''
  return JSON.stringify(content, null, 2)
}

function actorFor(agent: string): string {
  return AGENT_ACTORS[agent] ?? 'human'
}

function printHelp(): void {
  console.log(`Clara ledger CLI

Invoke the ledger tools directly. Role checks still apply: --agent decides who
is acting (clara -> human, 001 -> ai_1, 002 -> ai_2, 003 -> ai_3, judge -> ai_0,
unknown -> human).

Usage:
  pnpm clara:ledger list
  pnpm clara:ledger run <tool> [json] [--agent <id>] [--db <path>] [--json]
  pnpm clara:ledger help

Input:
  json      inline JSON object
  -         read JSON from stdin
  @path     read JSON from a file
  omitted   defaults to {}

Examples:
  pnpm clara:ledger list
  pnpm clara:ledger run clara_inbox
  pnpm clara:ledger run clara_ask '{"question":"what is in flight?"}'
  pnpm clara:ledger run clara_tick '{"dry_run":true}' --agent judge
  echo '{"question":"what is in flight?"}' | pnpm clara:ledger run clara_ask -

The actor is printed to stderr. Only the tool's content goes to stdout, so
redirecting the output captures the result without the header.`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.command === 'help') {
    printHelp()
    return
  }

  if (options.command !== 'list' && options.command !== 'run') {
    fail(`unknown command "${options.command}". Try \`pnpm clara:ledger help\`.`)
  }

  const dbPath = options.db ?? process.env.CLARA_LEDGER_DB_PATH ?? DEFAULT_DB_PATH
  const db = await getDb(dbPath)
  const tools = createTools(db)

  if (options.command === 'list') {
    if (options.args.length > 0) fail(`list does not take arguments`)
    const width = Math.max(...tools.map((tool) => toolId(tool.name).length))
    console.error(`ledger ${dbPath}`)
    for (const tool of tools) {
      const id = toolId(tool.name)
      console.log(`${id.padEnd(width)}  ${tool.description.split('\n')[0]}`)
    }
    return
  }

  const [requested, input] = options.args
  if (!requested) fail('run needs a tool name')
  if (options.args.length > 2) fail(`run takes one tool and one JSON argument`)
  if (input !== undefined && input.startsWith('--')) fail(`input must come before options`)

  const tool = resolveTool(tools, requested)
  const result = await tool.execute(readInput(input), { agent: options.agent })

  const id = toolId(tool.name)
  console.error(`${id} · agent=${options.agent} · actor=${actorFor(options.agent)} · ${dbPath}`)

  if (options.json) console.log(JSON.stringify(result, null, 2))
  else process.stdout.write(`${render(result.content)}\n`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
