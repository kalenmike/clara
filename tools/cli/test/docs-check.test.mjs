import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isCheckableLink,
  normalizePath,
  parseLinks,
  runChecks,
  splitTarget,
} from '../src/commands/docs-check.mjs'

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

test('the internal and guide documentation sets pass their checks', () => {
  assert.deepEqual(runChecks(), [])
})
