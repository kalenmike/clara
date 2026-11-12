import type { ClaraAction } from '@clara/shared-types'

export type HttpRequestAction = Extract<ClaraAction, { type: 'http.request' }>

/** Headers safe to forward after Node decompressed the body. */
export function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (name === 'content-encoding' || name === 'content-length' || name === 'transfer-encoding') {
      return
    }
    result[name] = value
  })
  return result
}
