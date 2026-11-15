import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

export class ChecksumError extends Error {
  constructor(expected: string, actual: string) {
    super(`The downloaded file does not match the published SHA-256 (expected ${expected}).`)
    this.name = 'ChecksumError'
    this.actual = actual
  }

  readonly actual: string
}

export type DownloadProgress = (received: number, total: number | undefined) => void

export type DownloadOptions = {
  url: string
  destination: string
  sha256: string
  /** Published size, used when the response has no content length. */
  size?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Retries after the first attempt. A checksum mismatch is never retried. */
  retries?: number
  retryDelayMs?: number
  onProgress?: DownloadProgress
}

export type DownloadResult = {
  bytes: number
}

/** Download one artifact, verify its digest, and leave it at `destination`. */
export async function downloadVerified(options: DownloadOptions): Promise<DownloadResult> {
  const retries = options.retries ?? 1
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await downloadOnce(options)
    } catch (cause) {
      lastError = cause
      if (cause instanceof ChecksumError || attempt === retries) throw cause
      await pause(options.retryDelayMs ?? 400)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function downloadOnce(options: DownloadOptions): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(options.url, {
    headers: { accept: 'application/octet-stream', 'user-agent': 'clara-cli' },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  })
  if (!response.ok) {
    throw new Error(`The adapter download answered ${response.status}.`)
  }

  const total = contentLength(response) ?? options.size
  const hash = createHash('sha256')
  const file = await open(options.destination, 'w', 0o600)
  let received = 0
  try {
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer())
      hash.update(buffer)
      received = buffer.length
      await writeAll(file, buffer)
      options.onProgress?.(received, total)
    } else {
      for await (const chunk of readChunks(response.body)) {
        hash.update(chunk)
        await writeAll(file, chunk)
        received += chunk.length
        options.onProgress?.(received, total)
      }
    }
  } finally {
    await file.close()
  }

  const digest = hash.digest('hex')
  if (digest !== options.sha256.toLowerCase()) throw new ChecksumError(options.sha256, digest)
  if (options.size !== undefined && received !== options.size) {
    throw new Error(`The adapter download was ${received} bytes, expected ${options.size}.`)
  }
  return { bytes: received }
}

async function* readChunks(
  body: NonNullable<Response['body']>
): AsyncGenerator<Uint8Array, void, void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, buffer: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset)
    offset += bytesWritten
  }
}

function contentLength(response: Response): number | undefined {
  const value = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
