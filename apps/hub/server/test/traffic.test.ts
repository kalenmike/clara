import { describe, expect, it } from 'vitest'
import { TRAFFIC_BUCKET_MS, TrafficMeter } from '../src/traffic.ts'

const MINUTE = TRAFFIC_BUCKET_MS

function clock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

describe('TrafficMeter', () => {
  it('accumulates totals and a per-transport split', () => {
    const meter = new TrafficMeter()
    meter.recordInbound(1_000, 'local')
    meter.recordInbound(2_000, 'relay')
    meter.recordOutbound(500, 'local')
    meter.recordRequest('local')
    meter.recordRequest('relay')
    meter.recordSessionOpened()
    meter.recordError('refused')

    const snapshot = meter.snapshot()
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.totals).toEqual({
      bytesIn: 3_000,
      bytesOut: 500,
      framesIn: 2,
      framesOut: 1,
      requests: 2,
      sessionsOpened: 1,
      sessionsClosed: 0,
    })
    expect(snapshot.byTransport.local).toMatchObject({ bytesIn: 1_000, bytesOut: 500, requests: 1 })
    expect(snapshot.byTransport.relay).toMatchObject({ bytesIn: 2_000, requests: 1 })
    expect(snapshot.errors.refused).toBe(1)
    expect(snapshot.series).toHaveLength(1)
  })

  it('reports a rate from the last complete minute only', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })

    meter.recordInbound(6_000, 'local')
    meter.recordRequest('local')
    expect(meter.snapshot().warmup).toBe(true)

    time.advance(MINUTE)
    meter.recordInbound(60_000, 'local')
    const snapshot = meter.snapshot()

    expect(snapshot.warmup).toBe(false)
    expect(snapshot.rate).toEqual({
      windowMs: MINUTE,
      bytesInPerSecond: 100,
      bytesOutPerSecond: 0,
      requestsPerMinute: 1,
      errorsPerMinute: 0,
    })
    // The current partial minute is in the series but never in the rate.
    expect(snapshot.series).toHaveLength(2)
  })

  it('returns zero rates when the previous minute had no traffic', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })
    meter.recordInbound(1_000, 'local')

    time.advance(MINUTE * 3)
    const snapshot = meter.snapshot()
    expect(snapshot.rate.bytesInPerSecond).toBe(0)
    expect(snapshot.rate.requestsPerMinute).toBe(0)
  })

  it('keeps only the last sixty minutes of buckets', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })

    for (let minute = 0; minute < 90; minute += 1) {
      meter.recordInbound(1_000, 'local')
      time.advance(MINUTE)
    }

    const snapshot = meter.snapshot()
    expect(snapshot.series.length).toBeLessThanOrEqual(60)
    expect(snapshot.totals.bytesIn).toBe(90_000)
    expect(snapshot.series.at(-1)?.at).toBe(
      new Date(Math.floor(time.now() / MINUTE) * MINUTE).toISOString()
    )
  })

  it('records nothing and discards the window while disabled', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })

    meter.recordInbound(1_000, 'local')
    expect(meter.snapshot().totals.bytesIn).toBe(1_000)

    meter.setEnabled(false)
    meter.recordInbound(5_000, 'local')
    meter.recordError('crypto')

    const disabled = meter.snapshot()
    expect(disabled.enabled).toBe(false)
    expect(disabled.totals.bytesIn).toBe(0)
    expect(disabled.series).toEqual([])
    expect(disabled.spike).toEqual([])
    expect(disabled.since).toBeUndefined()

    meter.setEnabled(true)
    const enabled = meter.snapshot()
    expect(enabled.enabled).toBe(true)
    expect(enabled.totals.bytesIn).toBe(0)
    expect(enabled.series).toHaveLength(1)
    expect(enabled.warmup).toBe(true)
  })

  it('flags a spike only after enough history and above the floor', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })

    // Five quiet minutes establish the baseline.
    for (let minute = 0; minute < 5; minute += 1) {
      meter.recordInbound(1_000, 'local')
      time.advance(MINUTE)
    }
    expect(meter.snapshot().spike).toEqual([])

    // A minute far above the median, but below the byte floor, stays quiet.
    meter.recordInbound(50_000, 'local')
    time.advance(MINUTE)
    expect(meter.snapshot().spike).toEqual([])

    // Above the floor and three times the median is a spike.
    meter.recordInbound(200_000, 'local')
    time.advance(MINUTE)
    const spike = meter.snapshot()
    expect(spike.spike).toContain('bytes')
    expect(spike.peak.bytesIn).toBe(200_000)
  })

  it('flags request and error spikes independently', () => {
    const time = clock()
    const meter = new TrafficMeter({ now: time.now })

    for (let minute = 0; minute < 5; minute += 1) {
      meter.recordRequest('local')
      time.advance(MINUTE)
    }

    for (let request = 0; request < 30; request += 1) meter.recordRequest('local')
    for (let error = 0; error < 5; error += 1) meter.recordError('orphan')
    time.advance(MINUTE)

    const snapshot = meter.snapshot()
    expect(snapshot.spike).toContain('requests')
    expect(snapshot.spike).toContain('errors')
    expect(snapshot.spike).not.toContain('bytes')
  })
})
