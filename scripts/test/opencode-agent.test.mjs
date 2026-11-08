import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  agentHash,
  installAgentFile,
  readAgentManifest,
  removeAgentFile,
} from '../lib/opencode-agent.mjs'

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-agent-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function source(dir, content = 'first version\n') {
  const path = join(dir, 'source.md')
  writeFileSync(path, content)
  return path
}

test('installs an agent and records its hash', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  const installed = installAgentFile({
    id: 'clara',
    source: source(dir),
    destination,
    manifestPath,
  })

  assert.equal(installed.written, true)
  assert.equal(readFileSync(destination, 'utf8'), 'first version\n')
  assert.equal(readAgentManifest(manifestPath).agents.clara, agentHash('first version\n'))
})

test('updates an unmodified generated agent', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  const sourcePath = source(dir)
  installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath })

  writeFileSync(sourcePath, 'second version\n')
  const installed = installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath })

  assert.equal(installed.written, true)
  assert.equal(readFileSync(destination, 'utf8'), 'second version\n')
})

test('refuses to overwrite a user-authored agent', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  const sourcePath = source(dir)
  installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath })
  writeFileSync(destination, 'my own agent\n')

  assert.throws(
    () => installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath }),
    /Refusing to overwrite/
  )
  assert.equal(readFileSync(destination, 'utf8'), 'my own agent\n')
})

test('force replaces a user-authored agent', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  const sourcePath = source(dir)
  installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath })
  writeFileSync(destination, 'my own agent\n')

  const installed = installAgentFile({
    id: 'clara',
    source: sourcePath,
    destination,
    manifestPath,
    force: true,
  })

  assert.equal(installed.written, true)
  assert.equal(readFileSync(destination, 'utf8'), 'first version\n')
})

test('removes only an unmodified generated agent', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  const sourcePath = source(dir)
  installAgentFile({ id: 'clara', source: sourcePath, destination, manifestPath })

  const removed = removeAgentFile({ id: 'clara', destination, manifestPath })
  assert.equal(removed.removed, true)
  assert.equal(existsSync(destination), false)
  assert.equal(readAgentManifest(manifestPath).agents.clara, undefined)
})

test('keeps a modified agent on removal', (t) => {
  const dir = workspace(t)
  const destination = join(dir, 'agents', 'clara.md')
  const manifestPath = join(dir, 'agents', '.clara-policy-agents.json')
  installAgentFile({ id: 'clara', source: source(dir), destination, manifestPath })
  writeFileSync(destination, 'my own agent\n')

  const removed = removeAgentFile({ id: 'clara', destination, manifestPath })
  assert.equal(removed.kept, true)
  assert.equal(existsSync(destination), true)
})
