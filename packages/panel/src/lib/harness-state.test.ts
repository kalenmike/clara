import { describe, expect, it } from 'vitest'
import { harnessState } from './harness-state.ts'

describe('harnessState', () => {
  it('reports a disabled harness before its live connection state', () => {
    expect(harnessState({ online: true, credentialConfigured: true }, false)).toEqual({
      key: 'disabled',
      label: 'Off',
      tone: 'neutral',
    })
  })

  it('separates a live adapter from a paired but offline one', () => {
    expect(harnessState({ online: true, credentialConfigured: true }, true)).toMatchObject({
      key: 'online',
      label: 'Online',
      tone: 'success',
    })
    expect(harnessState({ online: false, credentialConfigured: true }, true)).toMatchObject({
      key: 'paired',
      label: 'Paired · Offline',
      tone: 'warning',
    })
  })

  it('warns when a connection has no credential yet', () => {
    expect(harnessState({ online: false, credentialConfigured: false }, true)).toMatchObject({
      key: 'unpaired',
      label: 'Not paired',
      tone: 'warning',
    })
  })
})
