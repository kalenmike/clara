import { describe, expect, it } from 'vitest'
import {
  checkPanelRequest,
  isAllowedFetchSite,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackAddress,
} from '../src/panel/security.ts'

const PORT = 8790

describe('panel request guards', () => {
  it('accepts loopback addresses, including IPv4-mapped IPv6', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.10')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('accepts only the panel hostname and port', () => {
    expect(isAllowedHost(`127.0.0.1:${PORT}`, PORT)).toBe(true)
    expect(isAllowedHost(`localhost:${PORT}`, PORT)).toBe(true)
    expect(isAllowedHost(`[::1]:${PORT}`, PORT)).toBe(true)
    expect(isAllowedHost(`127.0.0.1:${PORT + 1}`, PORT)).toBe(false)
    expect(isAllowedHost(`127.0.0.1:${PORT}.evil.com`, PORT)).toBe(false)
    expect(isAllowedHost(`127.0.0.1.evil.com:${PORT}`, PORT)).toBe(false)
    expect(isAllowedHost(`evil.com:${PORT}`, PORT)).toBe(false)
    expect(isAllowedHost(`user@127.0.0.1:${PORT}`, PORT)).toBe(false)
    expect(isAllowedHost(`127.0.0.1:${PORT}/path`, PORT)).toBe(false)
    expect(isAllowedHost(undefined, PORT)).toBe(false)
  })

  it('accepts only same-origin http origins', () => {
    expect(isAllowedOrigin(`http://127.0.0.1:${PORT}`, PORT)).toBe(true)
    expect(isAllowedOrigin(`http://localhost:${PORT}`, PORT)).toBe(true)
    expect(isAllowedOrigin(undefined, PORT)).toBe(true)
    expect(isAllowedOrigin('https://127.0.0.1:8790', PORT)).toBe(false)
    expect(isAllowedOrigin('null', PORT)).toBe(false)
    expect(isAllowedOrigin(`http://evil.com:${PORT}`, PORT)).toBe(false)
    expect(isAllowedOrigin(`http://127.0.0.1:${PORT}/path`, PORT)).toBe(false)
  })

  it('rejects cross-site fetch metadata but allows non-browser clients', () => {
    expect(isAllowedFetchSite(undefined)).toBe(true)
    expect(isAllowedFetchSite('none')).toBe(true)
    expect(isAllowedFetchSite('same-origin')).toBe(true)
    expect(isAllowedFetchSite('same-site')).toBe(false)
    expect(isAllowedFetchSite('cross-site')).toBe(false)
  })

  it('combines every guard for a request', () => {
    const allowed = checkPanelRequest(
      {
        headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` },
        socket: { remoteAddress: '127.0.0.1' },
      },
      PORT
    )
    expect(allowed).toEqual({ ok: true })

    const remote = checkPanelRequest(
      {
        headers: { host: `127.0.0.1:${PORT}` },
        socket: { remoteAddress: '10.0.0.5' },
      },
      PORT
    )
    expect(remote.ok).toBe(false)

    const crossSite = checkPanelRequest(
      {
        headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'cross-site' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      PORT
    )
    expect(crossSite.ok).toBe(false)
  })

  it('allows a bridge address only with the explicit remote opt-in', () => {
    const request = {
      headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` },
      socket: { remoteAddress: '172.18.0.1' },
    }
    expect(checkPanelRequest(request, PORT).ok).toBe(false)
    expect(checkPanelRequest(request, PORT, { allowRemote: true })).toEqual({ ok: true })

    expect(
      checkPanelRequest({ ...request, headers: { host: `evil.example:${PORT}` } }, PORT, {
        allowRemote: true,
      }).ok
    ).toBe(false)
  })
})
