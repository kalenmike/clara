declare module 'bun:sqlite' {
  export type BunStatement = {
    all(...params: unknown[]): Record<string, unknown>[]
    get(...params: unknown[]): Record<string, unknown> | null
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }

  export class Database {
    constructor(
      filename: string,
      options?: {
        readonly?: boolean
        create?: boolean
        readwrite?: boolean
        safeIntegers?: boolean
        strict?: boolean
      }
    )
    prepare(sql: string): BunStatement
    exec(sql: string): void
    close(): void
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
  }
}
