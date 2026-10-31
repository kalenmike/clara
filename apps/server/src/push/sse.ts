const MAX_EVENT_BYTES = 16 * 1024 * 1024

/**
 * Minimal Server-Sent Events reader for the OpenCode event stream. Mirrors the
 * SDK parser: only `data:` lines matter, comments and event names are ignored.
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  onActivity?: () => void
): AsyncGenerator<unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onActivity?.()

      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_EVENT_BYTES) throw new Error('An SSE event is too large')

      const trailingCarriageReturn = buffer.endsWith('\r')
      if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
      buffer = buffer.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      if (trailingCarriageReturn) buffer += '\r'

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseBlock(block)
        if (event !== undefined) yield event
        boundary = buffer.indexOf('\n\n')
      }
    }

    if (buffer.trim() !== '') {
      const event = parseBlock(buffer)
      if (event !== undefined) yield event
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed.
    }
    reader.releaseLock()
  }
}

function parseBlock(block: string): unknown {
  const data = block
    .split('\n')
    .flatMap((line) => (line.startsWith('data:') ? [line.slice(5).trimStart()] : []))
    .join('\n')

  if (data === '') return undefined
  return JSON.parse(data) as unknown
}
