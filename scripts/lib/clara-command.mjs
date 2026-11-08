// Install the OpenCode /pipeline command that turns a chat message into a
// Clara orchestration entry point. The command is a prompt template, not a
// tool call by itself; it tells the agent to call clara_start with the full
// argument string.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function commandsDir() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configHome, 'opencode', 'commands')
}

export function commandPath() {
  return join(commandsDir(), 'pipeline.md')
}

export function commandBody() {
  return `---
description: Start a Clara orchestration pipeline for this request
---

Start a Clara orchestration pipeline for the following request.

Request:
$ARGUMENTS

Call the Clara start tool (for example \`clara_start\` through MCP, or
\`tools.clara.start\` in Code Mode) with:
- \`prompt\`: the complete request above.
- \`workspace\`: the absolute path of the current project. Run \`pwd\` if you do not already know it.
- no \`target\` unless I explicitly name a package or pipeline.

Follow the returned instructions. In conductor mode the adapter dispatches a
managed worker and returns a dispatch receipt; in work-order mode it returns a
work order you must execute. Do not just describe the pipeline.
If the Clara start tool is unavailable, say that the Clara adapter or MCP entry is not installed.
`
}

export function installCommand({ force = false } = {}) {
  const path = commandPath()
  const body = commandBody()
  mkdirSync(commandsDir(), { recursive: true, mode: 0o700 })
  if (existsSync(path) && !force) {
    // Do not overwrite a user-authored command with the same name.
    return { path, written: false }
  }
  writeFileSync(path, body, { mode: 0o600 })
  return { path, written: true }
}

export function removeCommand() {
  const path = commandPath()
  if (!existsSync(path)) return { path, removed: false }
  unlinkSync(path)
  return { path, removed: true }
}

export function commandExists() {
  return existsSync(commandPath())
}
