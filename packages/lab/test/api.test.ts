import { afterEach, describe, expect, it } from 'vitest'
import {
  configureLabApi,
  getLabTransport,
  getSource,
  getState,
  resolveLabPath,
  streamFetch,
  streamURL,
  type LabTransport,
} from '../src/api'

const original = getLabTransport()

afterEach(() => {
  configureLabApi(original)
})

function jsonFetch(record: string[]): typeof globalThis.fetch {
  return (input) => {
    record.push(String(input))
    return Promise.resolve(
      new Response(JSON.stringify({ workspace: '/workspace', calls: [], events: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  }
}

describe('configureLabApi', () => {
  it('resolves relative paths through the configured fetch', async () => {
    const record: string[] = []
    configureLabApi({ fetch: jsonFetch(record) })
    await getState()
    expect(record).toEqual(['/api/state'])
  })

  it('keeps the relative stream path', () => {
    expect(streamURL()).toBe('/api/stream')
  })

  it('defaults the stream fetch to the transport fetch', () => {
    const installed: LabTransport = { fetch: jsonFetch([]) }
    configureLabApi(installed)
    expect(streamFetch()).toBe(installed.fetch)
  })

  it('prefers a dedicated stream fetch', () => {
    const stream: typeof globalThis.fetch = () => Promise.resolve(new Response(null))
    configureLabApi({ fetch: jsonFetch([]), stream })
    expect(streamFetch()).toBe(stream)
  })

  it('maps /api paths onto a hub bridge base path', async () => {
    const record: string[] = []
    configureLabApi({ fetch: jsonFetch(record), basePath: '/v1/lab' })
    await getState()
    await getSource('packages/engine/default/index.yml')
    expect(record).toEqual([
      '/v1/lab/state',
      '/v1/lab/source?path=packages%2Fengine%2Fdefault%2Findex.yml',
    ])
  })

  it('normalizes the base path', () => {
    configureLabApi({ fetch: jsonFetch([]), basePath: 'v1/lab/' })
    expect(getLabTransport().basePath).toBe('/v1/lab')
    expect(resolveLabPath('/api/stream')).toBe('/v1/lab/stream')
    expect(resolveLabPath('/api/runs/3/steps/step-1')).toBe('/v1/lab/runs/3/steps/step-1')
    expect(resolveLabPath('/health')).toBe('/health')
  })

  it('leaves paths untouched without a base path', () => {
    configureLabApi({ fetch: jsonFetch([]), basePath: '' })
    expect(resolveLabPath('/api/state')).toBe('/api/state')
    configureLabApi({ fetch: jsonFetch([]), basePath: '/' })
    expect(resolveLabPath('/api/state')).toBe('/api/state')
  })
})
