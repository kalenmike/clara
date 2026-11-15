import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkoutVersion, devVersion } from '../../build/version.mjs'
import { root } from '../src/lib/router.mjs'

test('devVersion tags a checkout build with its commit', () => {
  assert.equal(devVersion('0.1.0', 'abc1234'), '0.1.0-dev+abc1234')
  assert.equal(devVersion('0.1.0', ''), '0.1.0-dev+local')
})

test('checkoutVersion identifies the repository', () => {
  assert.match(checkoutVersion(root), /^0\.1\.0-dev(?:\+[0-9a-f]{7})?$/)
})
