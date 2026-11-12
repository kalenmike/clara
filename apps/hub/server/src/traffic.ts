import type {
  PanelTraffic,
  PanelTrafficErrorKey,
  PanelTrafficPeak,
  PanelTrafficRate,
  PanelTrafficSample,
  PanelTrafficSpike,
  PanelTrafficTotals,
  PanelTrafficTransport,
  PanelTransport,
} from '@clara/shared-types'

/** One minute per bucket, sixty buckets per window. */
export const TRAFFIC_BUCKET_MS = 60_000
const TRAFFIC_WINDOW_BUCKETS = 60

const WINDOW_MS = TRAFFIC_BUCKET_MS * TRAFFIC_WINDOW_BUCKETS
const SPIKE_MIN_BUCKETS = 5
const SPIKE_FACTOR = 3
const SPIKE_MIN_BYTES = 64 * 1024
const SPIKE_MIN_REQUESTS = 10
const SPIKE_MIN_ERRORS = 3

type TransportCounters = PanelTrafficTransport
type ErrorCounters = Record<PanelTrafficErrorKey, number>

type Bucket = {
  minute: number
  local: TransportCounters
  relay: TransportCounters
  errors: number
}

export type TrafficMeterOptions = {
  /** The persisted monitoring choice; changed through `setEnabled`. */
  enabled?: boolean
  /** Injectable clock for tests. */
  now?: () => number
}

/**
 * Bounded, in-memory traffic counters for the panel. Nothing is persisted and
 * no payload is inspected: the meter only sees frame sizes, request counts, and
 * the outcome of frames the hub already had to reject.
 *
 * The enabled flag is cached rather than read from the database on every frame;
 * the controller calls `setEnabled` when the panel switch changes.
 */
export class TrafficMeter {
  private buckets: Bucket[] = []
  private local: TransportCounters = zeroTransport()
  private relay: TransportCounters = zeroTransport()
  private errors: ErrorCounters = zeroErrors()
  private sessionsOpened = 0
  private sessionsClosed = 0
  private enabledState: boolean
  private startedAt: number | undefined
  private readonly now: () => number

  constructor(options: TrafficMeterOptions = {}) {
    this.enabledState = options.enabled ?? true
    this.now = options.now ?? Date.now
  }

  get enabled(): boolean {
    return this.enabledState
  }

  /** Any transition discards the window so stale numbers cannot linger. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabledState) return
    this.enabledState = enabled
    this.reset()
  }

  reset(): void {
    this.buckets = []
    this.local = zeroTransport()
    this.relay = zeroTransport()
    this.errors = zeroErrors()
    this.sessionsOpened = 0
    this.sessionsClosed = 0
    this.startedAt = undefined
  }

  recordInbound(bytes: number, transport: PanelTransport): void {
    if (!this.active() || !isSize(bytes)) return
    const counters = this.counters(transport)
    counters.bytesIn += bytes
    counters.framesIn += 1
    const bucket = this.bucket()
    bucket[transport].bytesIn += bytes
    bucket[transport].framesIn += 1
  }

  recordOutbound(bytes: number, transport: PanelTransport): void {
    if (!this.active() || !isSize(bytes)) return
    const counters = this.counters(transport)
    counters.bytesOut += bytes
    counters.framesOut += 1
    const bucket = this.bucket()
    bucket[transport].bytesOut += bytes
    bucket[transport].framesOut += 1
  }

  recordRequest(transport: PanelTransport): void {
    if (!this.active()) return
    this.counters(transport).requests += 1
    this.bucket()[transport].requests += 1
  }

  recordError(key: PanelTrafficErrorKey): void {
    if (!this.active()) return
    this.errors[key] += 1
    this.bucket().errors += 1
  }

  recordSessionOpened(): void {
    if (!this.active()) return
    this.sessionsOpened += 1
  }

  recordSessionClosed(): void {
    if (!this.active()) return
    this.sessionsClosed += 1
  }

  snapshot(): PanelTraffic {
    if (!this.active()) return emptyTraffic()

    const now = this.now()
    const currentMinute = Math.floor(now / TRAFFIC_BUCKET_MS)
    this.prune(currentMinute)
    // Materialise the current minute so the chart always ends at "now", even
    // when the hub has been idle since the last poll.
    this.bucket()
    const complete = this.buckets.filter((bucket) => bucket.minute < currentMinute)
    const previous = complete.find((bucket) => bucket.minute === currentMinute - 1)

    return {
      enabled: true,
      since: new Date(this.startedAt ?? now).toISOString(),
      windowMs: WINDOW_MS,
      warmup: this.startedAt === undefined || now - this.startedAt < TRAFFIC_BUCKET_MS,
      totals: {
        bytesIn: this.local.bytesIn + this.relay.bytesIn,
        bytesOut: this.local.bytesOut + this.relay.bytesOut,
        framesIn: this.local.framesIn + this.relay.framesIn,
        framesOut: this.local.framesOut + this.relay.framesOut,
        requests: this.local.requests + this.relay.requests,
        sessionsOpened: this.sessionsOpened,
        sessionsClosed: this.sessionsClosed,
      },
      rate: previous ? rateOf(previous) : zeroRate(),
      errors: { ...this.errors },
      peak: peakOf(complete),
      series: this.buckets.map(toSample),
      byTransport: { local: { ...this.local }, relay: { ...this.relay } },
      spike: detectSpikes(complete, currentMinute, now, this.startedAt),
    }
  }

  private active(): boolean {
    if (!this.enabledState) return false
    if (this.startedAt === undefined) this.startedAt = this.now()
    return true
  }

  private counters(transport: PanelTransport): TransportCounters {
    return transport === 'relay' ? this.relay : this.local
  }

  private bucket(): Bucket {
    const minute = Math.floor(this.now() / TRAFFIC_BUCKET_MS)
    const last = this.buckets[this.buckets.length - 1]
    if (last && last.minute >= minute) return last

    const bucket: Bucket = {
      minute,
      local: zeroTransport(),
      relay: zeroTransport(),
      errors: 0,
    }
    this.buckets.push(bucket)
    this.prune(minute)
    return bucket
  }

  private prune(currentMinute: number): void {
    const oldest = currentMinute - (TRAFFIC_WINDOW_BUCKETS - 1)
    while (this.buckets.length > 0 && (this.buckets[0]?.minute ?? 0) < oldest) {
      this.buckets.shift()
    }
  }
}

export function emptyTraffic(): PanelTraffic {
  return {
    enabled: false,
    windowMs: WINDOW_MS,
    warmup: false,
    totals: zeroTotals(),
    rate: zeroRate(),
    errors: zeroErrors(),
    peak: zeroPeak(),
    series: [],
    byTransport: { local: zeroTransport(), relay: zeroTransport() },
    spike: [],
  }
}

function toSample(bucket: Bucket): PanelTrafficSample {
  return {
    at: new Date(bucket.minute * TRAFFIC_BUCKET_MS).toISOString(),
    bytesIn: bucket.local.bytesIn + bucket.relay.bytesIn,
    bytesOut: bucket.local.bytesOut + bucket.relay.bytesOut,
    requests: bucket.local.requests + bucket.relay.requests,
    errors: bucket.errors,
  }
}

function rateOf(bucket: Bucket): PanelTrafficRate {
  return {
    windowMs: TRAFFIC_BUCKET_MS,
    bytesInPerSecond: (bucket.local.bytesIn + bucket.relay.bytesIn) / (TRAFFIC_BUCKET_MS / 1000),
    bytesOutPerSecond: (bucket.local.bytesOut + bucket.relay.bytesOut) / (TRAFFIC_BUCKET_MS / 1000),
    requestsPerMinute: bucket.local.requests + bucket.relay.requests,
    errorsPerMinute: bucket.errors,
  }
}

function peakOf(complete: Bucket[]): PanelTrafficPeak {
  const peak = zeroPeak()
  for (const bucket of complete) {
    peak.bytesIn = Math.max(peak.bytesIn, bucket.local.bytesIn + bucket.relay.bytesIn)
    peak.bytesOut = Math.max(peak.bytesOut, bucket.local.bytesOut + bucket.relay.bytesOut)
    peak.requests = Math.max(peak.requests, bucket.local.requests + bucket.relay.requests)
    peak.errors = Math.max(peak.errors, bucket.errors)
  }
  return peak
}

/**
 * A spike is three times the median of the preceding half hour, above a floor
 * that keeps a quiet agent from flashing a warning on its first byte. The last
 * complete minute is compared, so the current partial minute never triggers it.
 */
function detectSpikes(
  complete: Bucket[],
  currentMinute: number,
  now: number,
  startedAt: number | undefined
): PanelTrafficSpike[] {
  if (startedAt === undefined) return []
  if (now - startedAt < SPIKE_MIN_BUCKETS * TRAFFIC_BUCKET_MS) return []

  const last = complete[complete.length - 1]
  if (!last || last.minute !== currentMinute - 1) return []

  const history = complete.slice(-31, -1)
  if (history.length < SPIKE_MIN_BUCKETS - 1) return []

  const spikes: PanelTrafficSpike[] = []
  const bytes = last.local.bytesIn + last.local.bytesOut + last.relay.bytesIn + last.relay.bytesOut
  const medianBytes = median(
    history.map(
      (bucket) =>
        bucket.local.bytesIn + bucket.local.bytesOut + bucket.relay.bytesIn + bucket.relay.bytesOut
    )
  )
  if (bytes >= SPIKE_MIN_BYTES && bytes >= SPIKE_FACTOR * medianBytes) spikes.push('bytes')

  const requests = last.local.requests + last.relay.requests
  const medianRequests = median(
    history.map((bucket) => bucket.local.requests + bucket.relay.requests)
  )
  if (requests >= SPIKE_MIN_REQUESTS && requests >= SPIKE_FACTOR * medianRequests) {
    spikes.push('requests')
  }

  const medianErrors = median(history.map((bucket) => bucket.errors))
  if (last.errors >= SPIKE_MIN_ERRORS && last.errors >= SPIKE_FACTOR * medianErrors) {
    spikes.push('errors')
  }

  return spikes
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function isSize(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function zeroTransport(): TransportCounters {
  return { bytesIn: 0, bytesOut: 0, framesIn: 0, framesOut: 0, requests: 0 }
}

function zeroTotals(): PanelTrafficTotals {
  return { ...zeroTransport(), sessionsOpened: 0, sessionsClosed: 0 }
}

function zeroRate(): PanelTrafficRate {
  return {
    windowMs: TRAFFIC_BUCKET_MS,
    bytesInPerSecond: 0,
    bytesOutPerSecond: 0,
    requestsPerMinute: 0,
    errorsPerMinute: 0,
  }
}

function zeroPeak(): PanelTrafficPeak {
  return { bytesIn: 0, bytesOut: 0, requests: 0, errors: 0 }
}

function zeroErrors(): ErrorCounters {
  return {
    handshake: 0,
    crypto: 0,
    orphan: 0,
    dropped: 0,
    refused: 0,
    limited: 0,
    upstream: 0,
    expired: 0,
  }
}
