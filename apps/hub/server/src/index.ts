import { main } from './main.ts'

export { main }

void main().catch((cause) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  console.error(`[clara] fatal: ${text}`)
  process.exit(1)
})
