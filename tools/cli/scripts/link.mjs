#!/usr/bin/env node
// Install a thin `clara-dev` shim that points at this checkout.
//
// The packaged `clara` command lives in apps/cli. This shim exposes the
// developer-only command under a separate name so both can coexist.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const entry = join(root, 'tools', 'cli', 'src', 'main.mjs')
const configured = process.env.CLARA_BIN_DIR?.trim()
const binDir = configured ? resolve(configured) : join(homedir(), '.local', 'bin')

if (!existsSync(entry)) {
  console.error(`error: missing CLI entry ${entry}`)
  process.exit(1)
}

mkdirSync(binDir, { recursive: true, mode: 0o755 })

if (process.platform === 'win32') {
  const path = join(binDir, 'clara-dev.cmd')
  writeFileSync(path, `@echo off\r\nnode "${entry}" %*\r\n`, { mode: 0o755 })
  console.log(`wrote ${path}`)
} else {
  const path = join(binDir, 'clara-dev')
  writeFileSync(path, `#!/bin/sh\nexec node "${entry}" "$@"\n`, { mode: 0o755 })
  chmodSync(path, 0o755)
  console.log(`wrote ${path}`)
}

const pathEntries = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
if (!pathEntries.includes(binDir)) {
  console.log(`Add ${binDir} to PATH, then run \`clara-dev --help\`.`)
} else {
  console.log('Run `clara-dev --help`.')
}
