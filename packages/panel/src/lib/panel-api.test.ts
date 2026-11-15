import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configurePanelApi,
  fetchPanelApi,
  getPanel,
  PanelApiError,
  type PanelApiRequest,
} from './panel-api.ts'

function statusRequest(signal?: AbortSignal): PanelApiRequest {
  return {
    method: 'GET',
    path: '/panel/api/v1/status',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  }
}

afterEach(() => {
  configurePanelApi(null)
  vi.unstubAllGlobals()
})

describe('panel api requests', () => {
  it('passes the abort signal through the same-origin fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPanelApi(statusRequest(controller.signal))

    expect(fetchMock).toHaveBeenCalledWith(
      '/panel/api/v1/status',
      expect.objectContaining({ signal: controller.signal, credentials: 'same-origin' })
    )
  })

  it('passes the abort signal from getPanel to the configured transport', async () => {
    const controller = new AbortController()
    const seen: PanelApiRequest[] = []
    configurePanelApi(async (request) => {
      seen.push(request)
      return new Response(JSON.stringify({ apiVersion: 13 }), { status: 200 })
    })

    const data = await getPanel<{ apiVersion: number }>('/panel/api/v1/status', {
      signal: controller.signal,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe('/panel/api/v1/status')
    expect(seen[0]?.signal).toBe(controller.signal)
    expect(seen[0]?.headers).toEqual({ accept: 'application/json' })
    expect(data.apiVersion).toBe(13)
  })

  it('reports a rejected request as a panel API error with its status', async () => {
    configurePanelApi(
      async () =>
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in' } }), {
          status: 401,
        })
    )

    const error = await getPanel('/panel/api/v1/status').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(PanelApiError)
    expect(error).toMatchObject({ status: 401, code: 'unauthorized', message: 'Sign in' })
  })
})
