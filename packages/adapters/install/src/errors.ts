/** A request error the caller can surface without turning it into a 500. */
export class InstallRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'InstallRequestError'
    this.status = status
    this.code = code
  }
}

export type InstallFailure = {
  status: number
  code: string
  message: string
}

export function readInstallFailure(cause: unknown): InstallFailure | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const record = cause as { status?: unknown; code?: unknown; message?: unknown }
  if (
    typeof record.status !== 'number' ||
    !Number.isInteger(record.status) ||
    record.status < 400 ||
    record.status > 599 ||
    typeof record.code !== 'string' ||
    typeof record.message !== 'string'
  ) {
    return undefined
  }
  return { status: record.status, code: record.code, message: record.message }
}
