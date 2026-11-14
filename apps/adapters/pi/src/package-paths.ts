import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The hub-facing adapter daemon entry. */
export function piAdapterDaemonEntry(): string {
  const candidates = [
    fileURLToPath(new URL('./index.js', import.meta.url)),
    fileURLToPath(new URL('./index.ts', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return fileURLToPath(new URL('./index.ts', import.meta.url))
}
