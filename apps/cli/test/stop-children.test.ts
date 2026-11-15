import { describe, expect, it } from 'vitest'
import { stopChildren, type StoppableChild } from '../src/supervisor/stop-children.ts'

type FakeChild = StoppableChild & {
  signals: NodeJS.Signals[]
  signalledAt: number[]
}

function fakeChild(label: string, behavior: { termMs?: number; killMs?: number } = {}): FakeChild {
  let done = false
  const signals: NodeJS.Signals[] = []
  const signalledAt: number[] = []
  return {
    label,
    signals,
    signalledAt,
    exited: () => done,
    signal(signal) {
      signals.push(signal)
      signalledAt.push(Date.now())
      if (signal === 'SIGTERM' && behavior.termMs !== undefined) {
        const timer = setTimeout(() => {
          done = true
        }, behavior.termMs)
        timer.unref?.()
      }
      if (signal === 'SIGKILL' && behavior.killMs !== undefined) {
        const timer = setTimeout(() => {
          done = true
        }, behavior.killMs)
        timer.unref?.()
      }
    },
  }
}

describe('stopChildren', () => {
  it('signals every child before waiting and finishes gracefully', async () => {
    const engine = fakeChild('engine', { termMs: 20 })
    const hub = fakeChild('hub', { termMs: 20 })
    const web = fakeChild('web', { termMs: 20 })

    const result = await stopChildren([engine, hub, web], { graceMs: 500, killMs: 100 })

    expect(result).toEqual({ graceful: true, survivors: [] })
    for (const child of [engine, hub, web]) {
      expect(child.signals).toEqual(['SIGTERM'])
    }
    // A sequential stop would signal each child only after the previous exited.
    const times = [engine, hub, web].map((child) => child.signalledAt[0] ?? 0)
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(25)
  })

  it('escalates the whole set to SIGKILL when one child ignores SIGTERM', async () => {
    const engine = fakeChild('engine', { termMs: 10 })
    const hub = fakeChild('hub', { killMs: 10 })
    const escalated: string[][] = []

    const result = await stopChildren([engine, hub], {
      graceMs: 40,
      killMs: 300,
      onEscalate: (labels) => escalated.push(labels),
    })

    expect(result).toEqual({ graceful: false, survivors: [] })
    expect(escalated).toEqual([['hub']])
    expect(hub.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('reports a child that survives SIGKILL', async () => {
    const engine = fakeChild('engine')

    const result = await stopChildren([engine], { graceMs: 20, killMs: 40 })

    expect(result).toEqual({ graceful: false, survivors: ['engine'] })
    expect(engine.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does nothing for an empty set', async () => {
    const result = await stopChildren([], { graceMs: 10, killMs: 10 })
    expect(result).toEqual({ graceful: true, survivors: [] })
  })
})
