import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = join(root, 'scripts', 'server.mjs')

function runServer(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('pair treats --local as a deployment target, not a pairing option', () => {
  const result = runServer(['pair', '--docker', '--local'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /both --docker and --local/)
  assert.doesNotMatch(result.stderr, /cannot be combined/)
})

test('pair accepts --no-relay without a deployment conflict', () => {
  const result = runServer(['pair', '--docker', '--no-relay', '--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /pair \[--no-relay\]/)
})
