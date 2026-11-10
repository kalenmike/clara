/**
 * A promise that never settles would otherwise leave a screen spinning with no
 * way to tell a slow device from a wedged request. The label lets callers turn
 * a timeout into copy for the step that stalled.
 */
export class TimeoutError extends Error {
  readonly label: string

  constructor(label: string) {
    super(`Timed out waiting for ${label}`)
    this.name = 'TimeoutError'
    this.label = label
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Clara'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        clearTimeout(timer)
        reject(cause)
      }
    )
  })
}
