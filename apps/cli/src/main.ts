#!/usr/bin/env node
import { bootstrapEmbedded } from './assets/bootstrap.ts'
import { runCli } from './cli.ts'

await bootstrapEmbedded()

void runCli(process.argv.slice(2)).catch((cause) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  console.error(`error: ${text}`)
  process.exitCode = 1
})
