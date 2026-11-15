import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const script = join(root, 'tools', 'cli', 'src', 'commands', 'server.mjs')

function runServer(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('pair accepts --no-relay', () => {
  const result = runServer(['pair', '--no-relay', '--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /clara pair hub \[--no-relay\]/)
})

test('help lists local hub commands without deployment flags', () => {
  const result = runServer(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /start hub \[--build\]/)
  assert.doesNotMatch(result.stdout, /--docker|--local/)
})
