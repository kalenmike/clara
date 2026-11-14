/** Errors raised by an adapter surface, translated to the harness wire shape. */
export class AdapterError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AdapterError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}
