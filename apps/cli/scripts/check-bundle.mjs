#!/usr/bin/env node
// Verify that Bun can analyze the packaged command. Everything the binary ships
// must resolve at build time; a runtime import of a workspace package, a harness
// SDK, or the native SQLite driver would break a machine without the repository.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../..')
const entry = join(packageRoot, 'src', 'main.ts')
const outdir = join(packageRoot, 'dist', 'check')
const generated = join(packageRoot, 'src', 'embedded-assets.generated.mjs')

const FORBIDDEN = [
  { pattern: /^@clara\//, reason: 'a workspace package' },
  { pattern: /^@opencode\//, reason: 'the OpenCode harness SDK' },
  { pattern: /^@anthropic-ai\//, reason: 'the Claude Code harness SDK' },
  { pattern: /^better-sqlite3(?:\/|$)/, reason: 'the native SQLite driver' },
]

const SPECIFIERS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*["']([^"']+)["']/g,
]

/** The generated manifest is a build artifact; a standalone check needs a stand-in. */
const placeholder = !existsSync(generated)
if (placeholder) {
  writeFileSync(generated, "export const assets = {}\nexport const buildId = 'check'\n")
}

let code = 0
try {
  code = check()
} finally {
  if (placeholder) rmSync(generated, { force: true })
}
process.exitCode = code

function check() {
  const built = build()
  if (built !== 0) return built

  const files = listFiles(outdir).filter((file) => /\.(?:mjs|cjs|js)$/.test(file))
  if (files.length === 0) return fail('the bundle produced no JavaScript files')

  const violations = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiers(source)) {
      const rule = FORBIDDEN.find(({ pattern }) => pattern.test(specifier))
      if (rule) violations.push(`${relative(outdir, file)} imports ${specifier} (${rule.reason})`)
    }
  }

  if (violations.length > 0) {
    console.error('The command would import packages at runtime:')
    for (const violation of violations) console.error(`  ${violation}`)
    console.error('Bundle the workspace package at build time instead of loading it at runtime.')
    return 1
  }

  console.log(`Bundle is analyzable: ${files.length} file(s), no runtime package imports.`)
  return 0
}

function build() {
  rmSync(outdir, { recursive: true, force: true })
  mkdirSync(outdir, { recursive: true })
  const bun = process.env.BUN_BIN?.trim() || 'bun'
  const result = spawnSync(
    bun,
    ['build', '--target=bun', '--conditions=bun', `--outdir=${outdir}`, entry],
    { cwd: repoRoot, stdio: 'inherit', env: process.env }
  )
  if (result.error) return fail(`${bun} could not run: ${result.error.message}`)
  return result.status ?? 1
}

function specifiers(source) {
  const found = new Set()
  for (const pattern of SPECIFIERS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.add(match[1])
    }
  }
  return found
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

function fail(message) {
  console.error(`clara bundle: ${message}`)
  return 1
}
