#!/usr/bin/env node
// Install a thin `clara` shim that points at this checkout.
//
// The compiled-binary route is deliberately not used yet: the CLI still needs a
// checkout for compose files, `--build`, and the MCP bridge, so a wrapper gives
// the same "run clara" convenience without a per-platform build.

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
  const path = join(binDir, 'clara.cmd')
  writeFileSync(path, `@echo off\r\nnode "${entry}" %*\r\n`, { mode: 0o755 })
  console.log(`wrote ${path}`)
} else {
  const path = join(binDir, 'clara')
  writeFileSync(path, `#!/bin/sh\nexec node "${entry}" "$@"\n`, { mode: 0o755 })
  chmodSync(path, 0o755)
  console.log(`wrote ${path}`)
}

const pathEntries = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
if (!pathEntries.includes(binDir)) {
  console.log(`Add ${binDir} to PATH, then run \`clara --help\`.`)
} else {
  console.log('Run `clara --help`.')
}
