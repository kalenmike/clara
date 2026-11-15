import { describe, expect, it } from 'vitest'
import { hubPanelCapabilities, hubPanelTransport } from './hub-panel'

describe('hubPanelTransport', () => {
  it('treats the local room as the loopback transport', () => {
    expect(hubPanelTransport('local')).toBe('local')
  })

  it('treats relay rooms and an unset room as relay', () => {
    expect(hubPanelTransport('room-1')).toBe('relay')
    expect(hubPanelTransport(undefined)).toBe('relay')
  })
})

describe('hubPanelCapabilities', () => {
  it('locks the local switch and Go offline on a local connection', () => {
    expect(hubPanelCapabilities('local')).toEqual({
      allowGoOffline: false,
      allowLocalToggle: false,
      allowRelayToggle: true,
      allowRelayTargetEdit: true,
    })
  })

  it('locks relay transport and target edits on a relay connection', () => {
    expect(hubPanelCapabilities('relay')).toEqual({
      allowGoOffline: false,
      allowLocalToggle: true,
      allowRelayToggle: false,
      allowRelayTargetEdit: false,
    })
  })
})
