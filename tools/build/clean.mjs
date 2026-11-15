#!/usr/bin/env node
// Remove a package's build outputs before Turborepo restores them from cache.
//
//   node tools/build/clean.mjs dist
//   node tools/build/clean.mjs dist dist-desktop
//
// Turborepo restores cached outputs over the working tree without removing
// files that are no longer part of the cache entry. Cleaning first makes a
// cache hit equivalent to a fresh build: no stale chunks, bundles, or
// feature-gated artifacts. Paths are relative to the package directory and
// support `*` and `**` segments.

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

for (const pattern of process.argv.slice(2)) {
  for (const path of expand(root, pattern.split('/'))) {
    rmSync(path, { recursive: true, force: true })
  }
}

function expand(directory, segments) {
  if (segments.length === 0) return [directory]
  const [head, ...rest] = segments
  if (head === '**') {
    return [
      ...expand(directory, rest),
      ...subdirectories(directory).flatMap((entry) => expand(entry, segments)),
    ]
  }
  if (head === '*') {
    return subdirectories(directory).flatMap((entry) => expand(entry, rest))
  }
  return expand(join(directory, head), rest)
}

function subdirectories(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name))
  } catch {
    return []
  }
}
