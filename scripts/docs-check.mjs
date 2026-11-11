#!/usr/bin/env node
// Validate the two documentation sets: the internal docs under docs/ and the
// public guide under apps/docs/guide/.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const guideRoot = join(root, 'apps/docs/guide')
const internalRoot = join(root, 'docs')
const guideIndex = join(guideRoot, 'index.md')
const internalIndex = join(internalRoot, 'README.md')

const IGNORED_SCHEMES = /^(?:https?:|mailto:|tel:|data:)/i
const IGNORED_PREFIXES = ['#', '?']

export function findMarkdownFiles(directory) {
  const files = []
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...findMarkdownFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full)
  }
  return files.sort()
}

export function parseLinks(markdown) {
  const links = []
  const pattern = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of markdown.matchAll(pattern)) {
    if (match[1] === '!') continue
    links.push(match[2])
  }
  return links
}

export function splitTarget(target) {
  const hash = target.indexOf('#')
  const withoutHash = hash === -1 ? target : target.slice(0, hash)
  const query = withoutHash.indexOf('?')
  return {
    path: query === -1 ? withoutHash : withoutHash.slice(0, query),
    anchor: hash === -1 ? '' : target.slice(hash + 1),
  }
}

export function isCheckableLink(target) {
  if (!target) return false
  if (IGNORED_SCHEMES.test(target)) return false
  if (IGNORED_PREFIXES.some((prefix) => target.startsWith(prefix))) return false
  return true
}

export function normalizePath(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function resolveLink(fromFile, target) {
  const { path } = splitTarget(target)
  if (!path) return { path: '', anchor: splitTarget(target).anchor }
  const absolute = path.startsWith('/')
    ? join(root, 'apps/docs/static', path)
    : resolve(dirname(fromFile), normalizePath(path))
  return { path: absolute, anchor: splitTarget(target).anchor }
}

export function indexTargets(indexFile) {
  const markdown = readFileSync(indexFile, 'utf8')
  return new Set(
    parseLinks(markdown)
      .filter(isCheckableLink)
      .filter((target) => !target.startsWith('/'))
      .map((target) => resolve(dirname(indexFile), normalizePath(splitTarget(target).path)))
      .filter((target) => target.endsWith('.md'))
  )
}

export function checkIndex({ name, root: directory, indexFile, exclude = [] }) {
  const errors = []
  const expected = new Set(
    findMarkdownFiles(directory)
      .filter((file) => file !== indexFile)
      .filter(
        (file) => !exclude.some((entry) => file === entry || file.startsWith(`${entry}${sep}`))
      )
  )
  const listed = indexTargets(indexFile)

  for (const file of expected) {
    if (!listed.has(file))
      errors.push(`${name}: ${relative(root, file)} is not listed in ${relative(root, indexFile)}`)
  }
  for (const file of listed) {
    if (!existsSync(file)) {
      errors.push(`${name}: ${relative(root, indexFile)} links to missing ${relative(root, file)}`)
    } else if (!expected.has(file)) {
      errors.push(
        `${name}: ${relative(root, indexFile)} lists ${relative(root, file)} which is not a canonical page`
      )
    }
  }

  return errors
}

export function checkLinks({ name, root: directory, exclude = [] }) {
  const errors = []
  for (const file of findMarkdownFiles(directory)) {
    if (exclude.some((entry) => file === entry || file.startsWith(`${entry}${sep}`))) continue
    const markdown = readFileSync(file, 'utf8')
    for (const target of parseLinks(markdown)) {
      if (!isCheckableLink(target) || target.startsWith('/')) continue
      const resolved = resolveLink(file, target)
      if (!resolved.path) continue
      if (!existsSync(resolved.path)) {
        errors.push(
          `${name}: ${relative(root, file)} links to missing ${relative(root, resolved.path)}`
        )
        continue
      }
      if (resolved.path.endsWith('.md')) continue
      const stats = statSync(resolved.path)
      if (stats.isDirectory() && !existsSync(join(resolved.path, 'index.md'))) {
        errors.push(
          `${name}: ${relative(root, file)} links to a directory without index.md: ${relative(root, resolved.path)}`
        )
      }
    }
  }
  return errors
}

export function checkGuideBoundary() {
  const errors = []
  for (const file of findMarkdownFiles(guideRoot)) {
    const markdown = readFileSync(file, 'utf8')
    for (const target of parseLinks(markdown)) {
      if (!isCheckableLink(target)) continue
      if (target.startsWith('/internals')) {
        const path = splitTarget(target).path.replace(/\/+$/, '')
        if (path !== '/internals') {
          errors.push(`guide: ${relative(root, file)} links into internal docs: ${target}`)
        }
        continue
      }
      const resolved = resolveLink(file, target)
      if (!resolved.path) continue
      const insideGuide =
        resolved.path === guideRoot || resolved.path.startsWith(`${guideRoot}${sep}`)
      if (!insideGuide) {
        errors.push(`guide: ${relative(root, file)} links outside the guide: ${target}`)
      }
    }
  }
  return errors
}

export function checkRecords() {
  const errors = []
  for (const file of [...findMarkdownFiles(guideRoot), ...findMarkdownFiles(internalRoot)]) {
    if (file.startsWith(join(internalRoot, 'records'))) continue
    const markdown = readFileSync(file, 'utf8')
    for (const target of parseLinks(markdown)) {
      if (!isCheckableLink(target)) continue
      const resolved = resolveLink(file, target)
      if (resolved.path.startsWith(join(internalRoot, 'records'))) {
        errors.push(`${relative(root, file)} links to an internal record: ${target}`)
      }
    }
  }
  return errors
}

export function runChecks() {
  const records = join(internalRoot, 'records')
  return [
    ...checkIndex({
      name: 'internal',
      root: internalRoot,
      indexFile: internalIndex,
      exclude: [records],
    }),
    ...checkIndex({ name: 'guide', root: guideRoot, indexFile: guideIndex }),
    ...checkLinks({
      name: 'internal',
      root: internalRoot,
      exclude: [records],
    }),
    ...checkLinks({ name: 'guide', root: guideRoot }),
    ...checkGuideBoundary(),
    ...checkRecords(),
  ]
}

async function main() {
  const json = process.argv.includes('--json')
  const errors = runChecks()
  if (json) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2))
  } else if (errors.length === 0) {
    console.log('Documentation checks passed.')
  } else {
    console.error(`Documentation checks failed with ${errors.length} issue(s):`)
    for (const error of errors) console.error(`  - ${error}`)
  }
  process.exitCode = errors.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

export { guideIndex, guideRoot, internalIndex, internalRoot, root }
