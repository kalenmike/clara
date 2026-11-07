import assert from 'node:assert/strict'
import test from 'node:test'
import { probeWorkerd, resolveWorkerd } from '../lib/workerd.mjs'

const spawn = (result) => () => result

test('accepts a workerd binary that runs', () => {
  assert.deepEqual(probeWorkerd('/workerd', spawn({ status: 0, stdout: 'v', stderr: '' })), {
    ok: true,
  })
})

test('treats a glibc relocation failure as a platform mismatch', () => {
  const status = probeWorkerd(
    '/workerd',
    spawn({
      status: 127,
      stdout: '',
      stderr: 'Error relocating /workerd: fcntl64: symbol not found',
    })
  )
  assert.equal(status.ok, false)
  assert.equal(status.platform, true)
  assert.match(status.reason, /fcntl64/)
})

test('keeps missing binaries and crashes fatal', () => {
  const missing = probeWorkerd(
    '/workerd',
    spawn({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawn /workerd ENOENT'), { code: 'ENOENT' }),
    })
  )
  assert.equal(missing.ok, false)
  assert.equal(missing.platform, false)
  assert.match(missing.reason, /ENOENT/)

  const crash = probeWorkerd(
    '/workerd',
    spawn({
      status: 1,
      stdout: '',
      stderr: 'error while loading shared libraries: libucontext.so.1',
    })
  )
  assert.equal(crash.platform, false)
  assert.match(crash.reason, /libucontext/)
})

test('prefers an explicit MINIFLARE_WORKERD_PATH', () => {
  assert.equal(resolveWorkerd({ MINIFLARE_WORKERD_PATH: '/custom/workerd' }), '/custom/workerd')
})
