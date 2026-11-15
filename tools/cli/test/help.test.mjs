import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { clara } from '../src/clara.mjs'
import { renderHelp, resolveCommand } from '../src/lib/router.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const entry = join(root, 'tools', 'cli', 'src', 'main.mjs')

function run(args) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' })
}

function walk(node, path = []) {
  const entries = [{ node, path }]
  for (const command of node.commands ?? []) {
    entries.push(...walk(command, [...path, command.name]))
  }
  return entries
}

test('every example uses the clara command', () => {
  for (const { node, path } of walk(clara)) {
    for (const example of node.examples ?? []) {
      assert.ok(example.startsWith('clara '), `${path.join(' ')}: ${example}`)
      const resolved = resolveCommand(clara, example.split(' ').slice(1))
      assert.equal(resolved.error, undefined, `${path.join(' ')}: ${example}`)
    }
  }
})

test('no rendered help mentions a package manager', () => {
  for (const { node, path } of walk(clara)) {
    const help = renderHelp(clara, path)
    assert.doesNotMatch(help, /pnpm/, path.join(' ') || 'clara')
  }
})

test('every rendered help has usage, options, and no trailing spaces', () => {
  for (const { path } of walk(clara)) {
    const help = renderHelp(clara, path)
    const label = path.join(' ') || 'clara'
    assert.match(help, /^Usage:\n {2}clara /m, label)
    assert.match(help, /\nOptions:\n/, label)
    assert.match(help, /^ {2}-h, --help {2,}Show help$/m, label)
    for (const line of help.split('\n')) {
      assert.equal(line, line.trimEnd(), `${label}: trailing space in "${line}"`)
    }
  }
})

test('aligned blocks share one description column', () => {
  const help = walk(clara)
    .map(({ path }) => renderHelp(clara, path))
    .join('\n\n')
  for (const block of help.split('\n\n')) {
    const [label, ...rows] = block.split('\n')
    if (!label.endsWith(':') || rows.length === 0) continue
    if (label === 'Usage:') continue
    let common
    for (const row of rows) {
      const columns = new Set()
      for (let index = 2; index < row.length; index++) {
        if (row[index] !== ' ' && row[index - 1] === ' ' && row[index - 2] === ' ') {
          columns.add(index)
        }
      }
      common = common === undefined ? columns : new Set([...common].filter((c) => columns.has(c)))
    }
    assert.ok(common.size > 0, `${label}: rows are not aligned`)
  }
})

for (const command of clara.commands) {
  test(`${command.name} help matches both entry points`, () => {
    const routed = run(['help', command.name])
    const direct = run([command.name, '--help'])
    assert.equal(routed.status, 0, routed.stderr)
    assert.equal(direct.status, 0, direct.stderr)
    assert.equal(direct.stdout, routed.stdout)
    assert.doesNotMatch(direct.stdout, /pnpm/)
  })
}

test('top-level help exits 0 and lists the tree', () => {
  const result = run([])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^Usage:\n {2}clara <command> \[options\]$/m)
  assert.doesNotMatch(result.stdout, /pnpm/)
})

test('rebuild without a subcommand prints help and exits 2', () => {
  const result = run(['rebuild'])
  assert.equal(result.status, 2)
  assert.match(result.stdout, /^Commands:\n {2}status {4}/m)
  assert.match(result.stdout, /\nExamples:\n {2}clara rebuild$/m)
})

test('an unknown command reports the parent help', () => {
  const result = run(['bogus'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Unknown command: bogus/)
  assert.match(result.stdout, /Lifecycle:/)
})
