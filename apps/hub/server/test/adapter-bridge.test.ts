import { describe, expect, it } from 'vitest'
import type { AdapterAction } from '@clara/shared-types'
import { AdapterSessionBridge } from '../src/harness/session.ts'

describe('AdapterSessionBridge', () => {
  it('rejects a pending request and sends adapter.abort when the signal aborts', async () => {
    const sent: AdapterAction[] = []
    const bridge = new AdapterSessionBridge((payload) => sent.push(payload))
    const controller = new AbortController()

    const pending = bridge.fetch(
      new Request('http://adapter/harness/v1/info', { signal: controller.signal })
    )
    const request = sent[0]
    if (request?.type !== 'adapter.request') throw new Error('no adapter request')

    controller.abort(new Error('Timed out waiting for the adapter'))

    await expect(pending).rejects.toThrow('Timed out waiting for the adapter')
    expect(sent).toContainEqual({ type: 'adapter.abort', id: request.id })
  })

  it('errors a started response stream when the signal aborts', async () => {
    const sent: AdapterAction[] = []
    const bridge = new AdapterSessionBridge((payload) => sent.push(payload))
    const controller = new AbortController()

    const pending = bridge.fetch(
      new Request('http://adapter/harness/v1/info', { signal: controller.signal })
    )
    const request = sent[0]
    if (request?.type !== 'adapter.request') throw new Error('no adapter request')

    bridge.handleState({
      type: 'adapter.response',
      id: request.id,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
    bridge.handleState({
      type: 'adapter.chunk',
      id: request.id,
      data: Buffer.from('{"ok":').toString('base64url'),
    })
    const response = await pending

    controller.abort(new Error('The browser went away'))
    await expect(response.text()).rejects.toThrow('The browser went away')
  })

  it('does not send adapter.abort after the adapter ends the request', async () => {
    const sent: AdapterAction[] = []
    const bridge = new AdapterSessionBridge((payload) => sent.push(payload))
    const controller = new AbortController()

    const pending = bridge.fetch(
      new Request('http://adapter/harness/v1/info', { signal: controller.signal })
    )
    const request = sent[0]
    if (request?.type !== 'adapter.request') throw new Error('no adapter request')

    bridge.handleState({
      type: 'adapter.response',
      id: request.id,
      status: 200,
      statusText: 'OK',
      headers: {},
    })
    bridge.handleState({ type: 'adapter.end', id: request.id })
    await pending

    controller.abort(new Error('late abort'))
    expect(sent.filter((payload) => payload.type === 'adapter.abort')).toHaveLength(0)
  })
})
