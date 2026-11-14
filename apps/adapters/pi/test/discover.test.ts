import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findPiBinary, probePi, readPiVersion, supportsRpc } from '../src/discover.ts'

const fake = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url))

describe('Pi discovery', () => {
  it('finds an explicit binary and reads its version', () => {
    expect(findPiBinary(fake)).toBe(fake)
    expect(readPiVersion(fake)).toBe('1.5.2')
    expect(supportsRpc(fake)).toBe(true)
  })

  it('reports a ready harness', async () => {
    const probe = await probePi({ piPath: fake }, 2_000)
    expect(probe).toMatchObject({ ok: true, version: '1.5.2', code: 'ready' })
  })

  it('reports an unconfigured harness when the binary is missing', async () => {
    const probe = await probePi({ piPath: '/nonexistent/pi' }, 2_000)
    expect(probe.ok).toBe(false)
    expect(probe.code).toBe('unconfigured')
  })
})
