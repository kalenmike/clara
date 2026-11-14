import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { selfEntry } from '@clara/adapter-runtime'

/** The hub-facing adapter daemon entry. */
export function piAdapterDaemonEntry(): string {
  // A compiled adapter is its own daemon entry.
  if (!selfEntry()) return process.execPath
  const candidates = [
    fileURLToPath(new URL('./index.js', import.meta.url)),
    fileURLToPath(new URL('./index.ts', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return fileURLToPath(new URL('./index.ts', import.meta.url))
}
