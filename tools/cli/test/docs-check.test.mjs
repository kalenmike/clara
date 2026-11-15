import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  checkFeatureBudgets,
  checkFeatureShape,
  checkNestedIndex,
  isCheckableLink,
  normalizePath,
  parseLinks,
  splitTarget,
} from '../src/commands/docs-check.mjs'

const SPEC_HEADINGS = [
  'Summary',
  'User flow',
  'Core business rules',
  'Edge cases',
  'Out of scope',
  'Technical appendix',
]

function fixture(t, tree) {
  const base = mkdtempSync(join(tmpdir(), 'clara-docs-check-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(tree)) {
    const full = join(base, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return base
}

function specText(omit = []) {
  return SPEC_HEADINGS.filter((heading) => !omit.includes(heading))
    .map((heading) => `## ${heading}\n\nText.\n`)
    .join('\n')
}

function nestedTree(chatIndexLinks) {
  return {
    'docs/README.md':
      '# Docs\n\n- [Features](features/capabilities.md)\n- [Chat](features/chat/index.md)\n- [Development](development.md)\n',
    'docs/development.md': '# Development\n',
    'docs/features/capabilities.md': '# Capabilities\n',
    'docs/features/chat/index.md': `# Chat\n\n${chatIndexLinks}\n`,
    'docs/features/chat/fork.md': '# Fork\n',
  }
}

test('parseLinks extracts markdown links and skips images', () => {
  const markdown = [
    '[Guide](getting-started.md)',
    '![Logo](/img/logo.png)',
    '[Relay](https://example.com)',
    '[Anchor](#section)',
  ].join('\n')

  assert.deepEqual(parseLinks(markdown), ['getting-started.md', 'https://example.com', '#section'])
})

test('splitTarget separates a path from its anchor and query', () => {
  assert.deepEqual(splitTarget('page.md?mode=1#section'), {
    path: 'page.md',
    anchor: 'section',
  })
  assert.deepEqual(splitTarget('#section'), { path: '', anchor: 'section' })
})

test('isCheckableLink skips external and in-page targets', () => {
  assert.equal(isCheckableLink('page.md'), true)
  assert.equal(isCheckableLink('https://example.com'), false)
  assert.equal(isCheckableLink('mailto:hello@example.com'), false)
  assert.equal(isCheckableLink('#section'), false)
})

test('normalizePath decodes escaped characters', () => {
  assert.equal(normalizePath('self-hosting%2Findex.md'), 'self-hosting/index.md')
})

test('a nested folder with a complete index chain has no index errors', (t) => {
  const base = fixture(t, nestedTree('- [Fork](fork.md)'))
  const docs = join(base, 'docs')

  assert.deepEqual(
    checkNestedIndex({ name: 'internal', root: docs, indexFile: join(docs, 'README.md'), base }),
    []
  )
})

test('a child missing from its folder index is reported', (t) => {
  const base = fixture(t, nestedTree('- Something else'))
  const docs = join(base, 'docs')

  assert.deepEqual(
    checkNestedIndex({ name: 'internal', root: docs, indexFile: join(docs, 'README.md'), base }),
    ['internal: docs/features/chat/fork.md is not listed in docs/features/chat/index.md']
  )
})

test('a section child missing from the root index is reported', (t) => {
  const tree = nestedTree('- [Fork](fork.md)')
  tree['docs/README.md'] =
    '# Docs\n\n- [Features](features/capabilities.md)\n- [Development](development.md)\n'
  const base = fixture(t, tree)
  const docs = join(base, 'docs')

  assert.ok(
    checkNestedIndex({
      name: 'internal',
      root: docs,
      indexFile: join(docs, 'README.md'),
      base,
    }).includes('internal: docs/features/chat/index.md is not listed in docs/README.md')
  )
})

test('a folder with Markdown children but no index.md is reported', (t) => {
  const tree = nestedTree('- [Fork](fork.md)')
  delete tree['docs/features/chat/index.md']
  const base = fixture(t, tree)
  const docs = join(base, 'docs')

  const errors = checkNestedIndex({
    name: 'internal',
    root: docs,
    indexFile: join(docs, 'README.md'),
    base,
  })

  assert.ok(errors.includes('internal: docs/features/chat has Markdown children but no index.md'))
})

test('a spec over 150 lines is reported with its line count', (t) => {
  const base = fixture(t, {
    'docs/features/chat/fork.md': Array.from({ length: 151 }, (_, index) => `Line ${index}`).join(
      '\n'
    ),
  })

  assert.deepEqual(checkFeatureBudgets({ directory: join(base, 'docs/features'), base }), [
    'internal: docs/features/chat/fork.md is 151 lines (max 150)',
  ])
})

test('a reference page may reach 300 lines and skips the spec shape', (t) => {
  const reference = ['---', 'title: Reference', 'kind: reference', '---', '']
  for (let index = 0; index < 295; index += 1) reference.push(`Line ${index}`)
  const markdown = reference.join('\n')
  const base = fixture(t, {
    'docs/features/orchestration/packages.md': markdown,
  })
  const directory = join(base, 'docs/features')

  assert.deepEqual(checkFeatureBudgets({ directory, base }), [])
  assert.deepEqual(checkFeatureShape({ directory, base }), [])

  writeFileSync(join(directory, 'orchestration/packages.md'), `${markdown}\nOne more line`)
  assert.deepEqual(checkFeatureBudgets({ directory, base }), [
    'internal: docs/features/orchestration/packages.md is 301 lines (max 300)',
  ])
})

test('a spec missing a required heading is reported', (t) => {
  const base = fixture(t, {
    'docs/features/chat/fork.md': specText(['Edge cases']),
  })

  assert.deepEqual(checkFeatureShape({ directory: join(base, 'docs/features'), base }), [
    'internal: docs/features/chat/fork.md is missing required heading "## Edge cases"',
  ])
})
