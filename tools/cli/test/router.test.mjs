import assert from 'node:assert/strict'
import test from 'node:test'
import { renderHelp, resolveCommand } from '../src/lib/router.mjs'

const tree = {
  name: 'demo',
  summary: 'Demo tools',
  examples: ['demo run'],
  commands: [
    {
      name: 'run',
      summary: 'Run something',
      usage: '[name]',
      options: [{ flags: '--now', description: 'Run immediately' }],
      run: () => 0,
    },
    {
      name: 'sub',
      summary: 'Subcommands',
      commands: [
        {
          name: 'leaf',
          summary: 'A leaf command',
          run: () => 0,
        },
      ],
    },
  ],
}

test('renders root help with commands, examples, and version', () => {
  const help = renderHelp(tree)
  assert.match(help, /Demo tools/)
  assert.match(help, /demo <command> \[options\]/)
  assert.match(help, /run\s+Run something/)
  assert.match(help, /-v, --version/)
  assert.match(help, /demo run/)
})

test('groups commands under their headings in first-appearance order', () => {
  const grouped = {
    name: 'demo',
    summary: 'Demo tools',
    commands: [
      { name: 'run', summary: 'Run something', group: 'Stack', run: () => 0 },
      { name: 'stop', summary: 'Stop something', group: 'Stack', run: () => 0 },
      { name: 'serve', summary: 'Serve something', group: 'Services', run: () => 0 },
      { name: 'misc', summary: 'Unfiled command', run: () => 0 },
    ],
  }
  const help = renderHelp(grouped)
  assert.match(help, /Stack:\n {2}run\s+Run something\n {2}stop\s+Stop something/)
  assert.match(help, /Services:\n {2}serve\s+Serve something/)
  assert.match(help, /Commands:\n {2}misc\s+Unfiled command/)
  assert.equal(help.match(/Stack:/g)?.length, 1)
  assert.doesNotMatch(help, /Services:\n[\s\S]*Stop something/)
})

test('aligns grouped command columns to the widest name', () => {
  const grouped = {
    name: 'demo',
    summary: 'Demo tools',
    commands: [
      { name: 'run', summary: 'Run', group: 'Stack', run: () => 0 },
      { name: 'orchestrator', summary: 'Orchestrate', group: 'Services', run: () => 0 },
    ],
  }
  const help = renderHelp(grouped)
  assert.match(help, / {2}run {11}Run/)
  assert.match(help, / {2}orchestrator {2}Orchestrate/)
})

test('renders leaf usage and options', () => {
  const help = renderHelp(tree, ['run'])
  assert.match(help, /demo run \[name\]/)
  assert.match(help, /--now\s+Run immediately/)
  assert.doesNotMatch(help, /--version/)
})

test('renders a custom executable name and several usage forms', () => {
  const custom = {
    name: 'demo',
    bin: 'demo-cli',
    summary: 'Demo tools',
    usage: ['one [options]', 'two <archive>'],
    version: false,
    options: [{ flags: '--now', description: 'Run immediately' }],
  }
  const help = renderHelp(custom)
  assert.match(help, /^Usage:\n {2}demo-cli one \[options\]\n {2}demo-cli two <archive>$/m)
  assert.doesNotMatch(help, /--version/)
})

test('renders sections with aligned columns', () => {
  const sectioned = {
    name: 'demo',
    summary: 'Demo tools',
    sections: [
      {
        label: 'Targets',
        items: [
          { name: 'run', description: 'Run it' },
          { name: 'orchestrator', description: 'Orchestrate' },
        ],
      },
    ],
    options: [{ flags: '--now', description: 'Run immediately' }],
  }
  const help = renderHelp(sectioned)
  assert.match(help, /Targets:\n {2}run {11}Run it\n {2}orchestrator {2}Orchestrate/)
  assert.match(help, /\nOptions:\n {2}--now {2,}Run immediately\n {2}-h, --help {2,}Show help/)
})

test('resolves nested commands and leaves arguments alone', () => {
  const resolved = resolveCommand(tree, ['run', 'thing', '--now'])
  assert.equal(resolved.path.join(' '), 'run')
  assert.deepEqual(resolved.args, ['thing', '--now'])
  assert.equal(resolved.help, false)
})

test('resolves nested groups', () => {
  const resolved = resolveCommand(tree, ['sub', 'leaf', '--help'])
  assert.equal(resolved.path.join(' '), 'sub leaf')
  assert.equal(resolved.help, true)
})

test('resolves help as an explicit request', () => {
  const resolved = resolveCommand(tree, ['help', 'sub'])
  assert.equal(resolved.path.join(' '), 'sub')
  assert.equal(resolved.help, true)
  assert.equal(resolved.explicitHelp, true)
})

test('reports an unknown command at its parent', () => {
  const resolved = resolveCommand(tree, ['bogus'])
  assert.equal(resolved.error.token, 'bogus')
  assert.equal(resolved.error.path.length, 0)
})

test('stops resolving at a leaf so help can pass through', () => {
  const passthrough = {
    name: 'demo',
    summary: 'Demo',
    commands: [
      {
        name: 'ledger',
        summary: 'Ledger',
        passthroughHelp: true,
        run: () => 0,
      },
    ],
  }
  const resolved = resolveCommand(passthrough, ['ledger', '--help'])
  assert.equal(resolved.path.join(' '), 'ledger')
  assert.deepEqual(resolved.args, ['--help'])
  assert.equal(resolved.help, true)
})
