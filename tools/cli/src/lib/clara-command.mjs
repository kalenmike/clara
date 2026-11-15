// Install the OpenCode /pipeline command for the generic MCP bridge.
//
// This is the manual work-order path. When the Clara adapter is installed, the
// human-facing entry point is the Clara agent and this command is not used.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MCP_COMMAND_MARKER = '<!-- clara:mcp-work-order -->'

export function commandsDir() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configHome, 'opencode', 'commands')
}

export function commandPath() {
  return join(commandsDir(), 'pipeline.md')
}

export function commandBody() {
  return `---
description: Run a Clara orchestration work order (manual MCP mode)
---

${MCP_COMMAND_MARKER}

This command is for the generic MCP bridge. When the Clara adapter is
installed, select the **Clara** agent instead; it submits the request and
handles escalations.

Submit the request below to Clara orchestration.

Request:
$ARGUMENTS

Call \`clara_start\` with:
- \`prompt\`: the complete request above.

The engine owns the workspace and its configured entry point. Do not pass
a workspace or a target; the entry point routes the request.

The result contains a work order. Read it and do the work with your own tools.
Close the step with \`clara_complete\`, \`clara_route\`, or \`clara_fail\` using the
returned identifiers. Do not just describe the pipeline.

If \`clara_start\` is unavailable, say that the Clara MCP entry is not installed.
`
}

const GENERATED_DESCRIPTIONS = [
  'Start a Clara orchestration pipeline for this request',
  'Start a Clara orchestration pipeline for the following request.',
]

const GENERATED_CALLS = ['Call the `clara_start` tool', 'Call the Clara start tool']

export function isGeneratedCommand(body) {
  if (body.includes(MCP_COMMAND_MARKER)) return true
  return (
    GENERATED_DESCRIPTIONS.some((line) => body.includes(line)) &&
    GENERATED_CALLS.some((line) => body.includes(line))
  )
}

export function installCommand({ force = false } = {}) {
  const path = commandPath()
  const body = commandBody()
  mkdirSync(commandsDir(), { recursive: true, mode: 0o700 })
  if (existsSync(path) && !force) {
    const existing = readFileSync(path, 'utf8')
    // Update an old generated command, but keep a user-authored one.
    if (!isGeneratedCommand(existing)) return { path, written: false, kept: true }
  }
  writeFileSync(path, body, { mode: 0o600 })
  return { path, written: true, kept: false }
}

export function removeCommand() {
  const path = commandPath()
  if (!existsSync(path)) return { path, removed: false, kept: false }
  unlinkSync(path)
  return { path, removed: true, kept: false }
}

export function removeGeneratedCommand() {
  const path = commandPath()
  if (!existsSync(path)) return { path, removed: false, kept: false }
  const body = readFileSync(path, 'utf8')
  if (body.includes(MCP_COMMAND_MARKER)) return { path, removed: false, kept: true }
  if (!isGeneratedCommand(body)) return { path, removed: false, kept: true }
  unlinkSync(path)
  return { path, removed: true, kept: false }
}

export function commandExists() {
  return existsSync(commandPath())
}
