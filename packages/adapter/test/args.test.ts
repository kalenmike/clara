import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOptions, UsageError } from '../src/args.ts'

test('collects multiple harness flags and per-harness MCP targets', () => {
  const options = parseOptions([
    'install',
    '--opencode',
    '--claudecode',
    '--mcp',
    '--mcp-for',
    'opencode',
  ])
  assert.deepEqual(options.harnesses, ['opencode', 'claudecode'])
  assert.equal(options.mcp, true)
  assert.deepEqual(options.mcpFor, ['opencode'])
})

test('accepts a harness as a positional for the old command shape', () => {
  assert.deepEqual(parseOptions(['install', 'opencode']).harnesses, ['opencode'])
})

test('deduplicates repeated harness flags', () => {
  assert.deepEqual(parseOptions(['install', '--opencode', '--opencode']).harnesses, ['opencode'])
})

test('rejects conflicting runner flags', () => {
  assert.throws(
    () => parseOptions(['install', '--opencode', '--runner', '--no-runner']),
    UsageError
  )
})

test('rejects an unknown harness name', () => {
  assert.throws(() => parseOptions(['install', 'cursor']), /unknown harness/)
})
