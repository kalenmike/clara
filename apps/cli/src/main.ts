#!/usr/bin/env node
import { runCli } from './cli.ts'

void runCli(process.argv.slice(2)).catch((cause) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  console.error(`error: ${text}`)
  process.exitCode = 1
})
