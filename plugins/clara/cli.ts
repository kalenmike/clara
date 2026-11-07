#!/usr/bin/env node
// Clara ledger CLI.
//
// Invoke the ledger tools directly, without an OpenCode agent. This is for
// testing and for answering "what would the agent have gotten back?" — the
// same tool definitions, the same role checks, the same ledger.
//
//   pnpm clara ledger list
//   pnpm clara ledger run clara_inbox
//   pnpm clara ledger run clara_ask '{"question":"what is in flight?"}'
//
// The role is derived from --agent exactly as it is inside OpenCode:
// clara -> human, 001-004 -> worker, judge -> closer.

import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_DB_PATH, getDb } from './db.ts'
import { ROLE_FOR_AGENT, createTools, toolId, type ClaraTool } from './index.ts'
import {
  catalogPipelines,
  loadPipeline,
  pipelineDir,
  pipelineForRequest,
  readPipelineFile,
  selectWorkspacePipeline,
  type Pipeline,
} from './pipeline.ts'
import { ensureWorkspace, requestByRef } from './queries.ts'

type Options = {
  command: string
  args: string[]
  agent: string
  db?: string
  path?: string
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
  let path: string | undefined
  let json = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h')
      return { command: 'help', args: [], agent, db, path, json }
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
    if (arg === '--path') {
      path = argv[++index] ?? fail('--path needs a value')
      continue
    }
    if (arg.startsWith('--path=')) {
      path = arg.slice('--path='.length)
      continue
    }
    if (arg.startsWith('-') && arg !== '-') fail(`unknown option ${arg}`)

    positional.push(arg)
  }

  const [command = 'help', ...args] = positional
  return { command, args, agent, db, path, json }
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
  return ROLE_FOR_AGENT[agent] ?? 'unknown'
}

function printHelp(): void {
  console.log(`Clara ledger CLI

Invoke the ledger tools directly. Role checks still apply: --agent decides who
is acting (clara -> human, 001-004 -> worker, judge -> closer, unknown -> no
write privileges).

Usage:
  pnpm clara ledger list
  pnpm clara ledger run <tool> [json] [--agent <id>] [--db <path>] [--json]
  pnpm clara ledger pipeline list|validate|select|show ...
  pnpm clara ledger help

Input:
  json      inline JSON object
  -         read JSON from stdin
  @path     read JSON from a file
  omitted   defaults to {}

Examples:
  pnpm clara ledger list
  pnpm clara ledger run clara_inbox
  pnpm clara ledger run clara_ask '{"question":"what is in flight?"}'
  pnpm clara ledger run clara_cancel '{"request":42,"reason":"human"}'
  pnpm clara ledger run clara_tick '{"dry_run":true}' --agent judge
  echo '{"question":"what is in flight?"}' | pnpm clara ledger run clara_ask -

Pipeline commands:
  pnpm clara ledger pipeline list
  pnpm clara ledger pipeline validate software
  pnpm clara ledger pipeline validate ./my-pipeline.json
  pnpm clara ledger pipeline select clara content
  pnpm clara ledger pipeline show clara
  pnpm clara ledger pipeline show 42

The actor is printed to stderr. Only the tool's content goes to stdout, so
redirecting the output captures the result without the header.`)
}

function formatPipeline(pipeline: Pipeline, label: string): string {
  const lines = [
    `${pipeline.id}@${pipeline.version} — ${pipeline.name} [${label}]`,
    ...(pipeline.description ? [pipeline.description] : []),
    '',
  ]
  pipeline.stages.forEach((stage, index) => {
    lines.push(
      `${index + 1}. ${stage.id} — ${stage.title} · ${stage.phase} · agent ${stage.agent} · ${stage.role}`
    )
    if (stage.evidence) {
      lines.push(
        `   evidence: ${Object.entries(stage.evidence)
          .map(
            ([key, spec]) =>
              `${key}:${spec.type}${spec.required ? ' required' : ''}${spec.immutable ? ' immutable' : ''}`
          )
          .join(', ')}`
      )
    }
    if (stage.when) lines.push(`   when: ${JSON.stringify(stage.when)}`)
    if (stage.gate) lines.push(`   gate: ${stage.gate.position} ${stage.gate.kind}`)
  })
  return lines.join('\n')
}

async function runPipeline(options: Options): Promise<void> {
  const [subcommand = 'list', ...args] = options.args

  if (subcommand === 'list') {
    if (args.length) fail('pipeline list does not take arguments')
    const catalog = catalogPipelines()
    console.log(`pipelines in ${pipelineDir()}`)
    for (const entry of catalog.pipelines) {
      const location = entry.source === 'builtin' ? 'builtin' : entry.path
      console.log(
        `  ${entry.pipeline.id}@${entry.pipeline.version}  ${entry.pipeline.name}  ` +
          `[${entry.source}] ${entry.pipeline.stages.length} stage(s)  ${location}`
      )
    }
    if (catalog.errors.length) {
      for (const error of catalog.errors) {
        console.error(`  invalid ${error.id ?? error.path}: ${error.errors.join('; ')}`)
      }
      process.exit(1)
    }
    return
  }

  if (subcommand === 'validate') {
    const target = args[0]
    if (!target) fail('pipeline validate needs an id or a file path')
    if (existsSync(target)) {
      const result = readPipelineFile(target)
      if (!result.pipeline) {
        for (const error of result.errors) console.error(`  ${error}`)
        process.exit(1)
        return
      }
      console.log(
        `ok ${result.pipeline.id}@${result.pipeline.version} — ${result.pipeline.stages.length} stage(s) · ${target}`
      )
      return
    }
    try {
      const loaded = loadPipeline(target)
      console.log(
        `ok ${loaded.pipeline.id}@${loaded.pipeline.version} — ${loaded.pipeline.stages.length} stage(s) · ${loaded.source}`
      )
    } catch (error) {
      fail((error as Error).message)
    }
    return
  }

  if (subcommand === 'select') {
    const [workspace, id] = args
    if (!workspace || !id) fail('pipeline select needs a workspace and a pipeline id')
    const dbPath = options.db ?? process.env.CLARA_LEDGER_DB_PATH ?? DEFAULT_DB_PATH
    const db = await getDb(dbPath)
    if (options.path) ensureWorkspace(db, workspace, options.path)
    console.log(selectWorkspacePipeline(db, workspace, id))
    return
  }

  if (subcommand === 'show') {
    const target = args[0]
    if (!target) fail('pipeline show needs a request id, slug, or workspace')
    const dbPath = options.db ?? process.env.CLARA_LEDGER_DB_PATH ?? DEFAULT_DB_PATH
    const db = await getDb(dbPath)
    const request = requestByRef(db, target)
    if (request) {
      console.log(formatPipeline(pipelineForRequest(db, request), 'pinned'))
      return
    }
    const workspace = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(target)
    if (!workspace) {
      try {
        console.log(formatPipeline(loadPipeline(target).pipeline, 'pipeline'))
        return
      } catch {
        fail(`no request, workspace, or pipeline "${target}"`)
      }
    }
    const id =
      typeof workspace.pipeline_id === 'string' && workspace.pipeline_id
        ? workspace.pipeline_id
        : 'software'
    console.log(formatPipeline(loadPipeline(id).pipeline, `workspace ${target}`))
    return
  }

  fail(`unknown pipeline command "${subcommand}". Try \`pnpm clara ledger pipeline list\`.`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.command === 'help') {
    printHelp()
    return
  }

  if (options.command === 'pipeline') {
    await runPipeline(options)
    return
  }

  if (options.command !== 'list' && options.command !== 'run') {
    fail(`unknown command "${options.command}". Try \`pnpm clara ledger help\`.`)
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
