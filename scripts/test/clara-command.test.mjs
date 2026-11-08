import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  MCP_COMMAND_MARKER,
  commandBody,
  commandPath,
  installCommand,
  removeGeneratedCommand,
} from '../lib/clara-command.mjs'

function configHome(t) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-command-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  t.after(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  })
  return join(dir, 'opencode', 'commands', 'pipeline.md')
}

const legacy = `---
description: Start a Clara orchestration pipeline for this request
---

Start a Clara orchestration pipeline for the following request.

Request:
$ARGUMENTS

Call the \`clara_start\` tool with:
- \`prompt\`: the complete request above.

Then read the returned work order and follow it. Do not just describe the pipeline.
`

test('the installed command is the manual MCP work-order path', () => {
  const body = commandBody()
  assert.match(body, new RegExp(MCP_COMMAND_MARKER))
  assert.match(body, /manual MCP mode/)
  assert.match(body, /clara_complete/)
  assert.doesNotMatch(body, /In conductor mode/)
})

test('installs the manual command and keeps a user-authored command', (t) => {
  const path = configHome(t)
  const installed = installCommand()
  assert.equal(installed.written, true)
  assert.match(readFileSync(path, 'utf8'), new RegExp(MCP_COMMAND_MARKER))

  writeFileSync(path, 'Review $ARGUMENTS for bugs.\n')
  const kept = installCommand()
  assert.equal(kept.kept, true)
  assert.equal(readFileSync(path, 'utf8'), 'Review $ARGUMENTS for bugs.\n')
})

test('updates an old generated command without force', (t) => {
  const path = configHome(t)
  installCommand()
  writeFileSync(path, legacy)

  const installed = installCommand()
  assert.equal(installed.written, true)
  assert.match(readFileSync(path, 'utf8'), new RegExp(MCP_COMMAND_MARKER))
})

test('removes an old generated command', (t) => {
  const path = configHome(t)
  installCommand()
  writeFileSync(path, legacy)

  const removed = removeGeneratedCommand()
  assert.equal(removed.removed, true)
  assert.equal(existsSync(path), false)
})

test('keeps the manual MCP command when removing the adapter command', (t) => {
  const path = configHome(t)
  installCommand()
  const before = readFileSync(path, 'utf8')

  const removed = removeGeneratedCommand()
  assert.equal(removed.kept, true)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('keeps a user-authored command', (t) => {
  const path = configHome(t)
  installCommand()
  writeFileSync(path, 'Review $ARGUMENTS for bugs.\n')

  const removed = removeGeneratedCommand()
  assert.equal(removed.kept, true)
  assert.equal(existsSync(commandPath()), true)
})
