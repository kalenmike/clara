export class ClaraApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ClaraApiError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }

  static async from(response: Response): Promise<ClaraApiError> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }

    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
    const code = typeof error?.code === 'string' ? error.code : 'http_error'
    const message =
      typeof error?.message === 'string'
        ? error.message
        : `Clara API responded with ${response.status}`
    return new ClaraApiError(response.status, code, message, error?.details)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
