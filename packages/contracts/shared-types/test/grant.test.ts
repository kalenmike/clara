import { describe, expect, it } from 'vitest'
import {
  DEVICE_GRANT_TTL_SECONDS,
  ENROLLMENT_GRANT_TTL_SECONDS,
  RELAY_GRANT_CLOCK_LEEWAY_SECONDS,
  RELAY_GRANT_MAX_ID_LENGTH,
  RELAY_GRANT_VERSION,
  createRelayGrant,
  decodeRelayGrantPayload,
  encodeRelayGrantPayload,
  signRelayGrant,
  verifyRelayGrant,
  type RelayGrantPayload,
} from '../src/index.ts'

const AGENT_TOKEN = 'test-agent-token-0123456789abcdef'
const ROOM = 'room-1'
const NOW = 1_900_000_000

function payload(overrides: Partial<RelayGrantPayload> = {}): RelayGrantPayload {
  return {
    v: RELAY_GRANT_VERSION,
    room: ROOM,
    role: 'client',
    id: 'device-1',
    exp: NOW + ENROLLMENT_GRANT_TTL_SECONDS,
    ...overrides,
  }
}

function sign(overrides: Partial<RelayGrantPayload> = {}): Promise<string> {
  return signRelayGrant(payload(overrides), AGENT_TOKEN)
}

function verify(grant: string, overrides: { room?: string; nowSeconds?: number } = {}) {
  return verifyRelayGrant(grant, {
    agentToken: AGENT_TOKEN,
    room: overrides.room ?? ROOM,
    nowSeconds: overrides.nowSeconds ?? NOW,
  })
}

describe('relay grant encoding', () => {
  it('writes the payload fields in canonical order', () => {
    const encoded = encodeRelayGrantPayload(payload())
    expect(new TextDecoder().decode(base64UrlToBytes(encoded))).toBe(
      '{"v":1,"room":"room-1","role":"client","id":"device-1","exp":1900000600}'
    )
    expect(decodeRelayGrantPayload(encoded)).toEqual(payload())
  })

  it('emits base64url only', () => {
    return sign().then((grant) => {
      expect(grant).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    })
  })

  it('publishes the grant lifetimes', () => {
    expect(ENROLLMENT_GRANT_TTL_SECONDS).toBe(600)
    expect(DEVICE_GRANT_TTL_SECONDS).toBe(2_592_000)
    expect(RELAY_GRANT_CLOCK_LEEWAY_SECONDS).toBe(60)
  })
})

describe('relay grant verification', () => {
  it('round-trips a signed grant', async () => {
    const grant = await sign()
    await expect(verify(grant)).resolves.toEqual({ ok: true, payload: payload() })
  })

  it('rejects a tampered payload', async () => {
    const grant = await sign()
    const [encoded, signature] = grant.split('.')
    const text = new TextDecoder().decode(base64UrlToBytes(encoded)).replace('device-1', 'device-2')
    const tampered = `${bytesToBase64Url(new TextEncoder().encode(text))}.${signature}`
    await expect(verify(tampered)).resolves.toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a tampered signature', async () => {
    const grant = await sign()
    const [encoded, signature] = grant.split('.')
    const first = signature[0] === 'A' ? 'B' : 'A'
    const tampered = `${encoded}.${first}${signature.slice(1)}`
    await expect(verify(tampered)).resolves.toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a grant for another room', async () => {
    const grant = await sign()
    await expect(verify(grant, { room: 'room-2' })).resolves.toEqual({
      ok: false,
      reason: 'wrong_room',
    })
  })

  it('expires after the clock leeway', async () => {
    const grant = await sign({ exp: NOW - RELAY_GRANT_CLOCK_LEEWAY_SECONDS - 1 })
    await expect(verify(grant)).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('accepts a grant inside the clock leeway', async () => {
    const grant = await sign({ exp: NOW - RELAY_GRANT_CLOCK_LEEWAY_SECONDS + 1 })
    await expect(verify(grant)).resolves.toMatchObject({ ok: true })
  })

  it('rejects malformed grants', async () => {
    for (const grant of [
      '',
      '.',
      'abc',
      'abc.def.ghi',
      `${encode('not json')}.${'A'.repeat(43)}`,
    ]) {
      const result = await verify(grant)
      expect(result).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('rejects a signature with the wrong length', async () => {
    const [encoded] = (await sign()).split('.')
    await expect(verify(`${encoded}.AAAA`)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })
})

describe('relay grant identity bounds', () => {
  it('accepts a 128-character id', async () => {
    const grant = await sign({ id: 'a'.repeat(RELAY_GRANT_MAX_ID_LENGTH) })
    await expect(verify(grant)).resolves.toMatchObject({ ok: true })
  })

  it('refuses to sign an empty or oversized id', async () => {
    await expect(sign({ id: '' })).rejects.toThrow()
    await expect(sign({ id: 'a'.repeat(RELAY_GRANT_MAX_ID_LENGTH + 1) })).rejects.toThrow()
  })

  it('rejects an oversized id before checking the signature', async () => {
    const grant = await sign()
    const [encoded, signature] = grant.split('.')
    const text = new TextDecoder()
      .decode(base64UrlToBytes(encoded))
      .replace('device-1', 'a'.repeat(RELAY_GRANT_MAX_ID_LENGTH + 1))
    const tampered = `${bytesToBase64Url(new TextEncoder().encode(text))}.${signature}`
    await expect(verify(tampered)).resolves.toEqual({ ok: false, reason: 'invalid_payload' })
  })
})

describe('relay grant creation', () => {
  it('returns a grant and its expiry in milliseconds', async () => {
    const created = await createRelayGrant({
      room: ROOM,
      id: 'adapter-1',
      agentToken: AGENT_TOKEN,
      ttlSeconds: DEVICE_GRANT_TTL_SECONDS,
      nowSeconds: NOW,
    })
    expect(created.expiresAt).toBe((NOW + DEVICE_GRANT_TTL_SECONDS) * 1000)
    await expect(verify(created.grant)).resolves.toMatchObject({
      ok: true,
      payload: { id: 'adapter-1', exp: NOW + DEVICE_GRANT_TTL_SECONDS },
    })
  })
})

function encode(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
