#!/usr/bin/env node
// Validate the two documentation sets: the internal docs under docs/ and the
// public guide under tools/docs/guide/.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const guideRoot = join(root, 'tools/docs/guide')
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
    ? join(root, 'tools/docs/static', path)
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

export function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  return match ? match[1] : ''
}

export function countLines(markdown) {
  if (markdown === '') return 0
  const lines = markdown.split(/\r?\n/)
  return markdown.endsWith('\n') ? lines.length - 1 : lines.length
}

export function isReferenceDoc(markdown) {
  return /^kind:\s*reference\s*$/m.test(frontmatter(markdown))
}

export const REQUIRED_SPEC_HEADINGS = [
  'Summary',
  'User flow',
  'Core business rules',
  'Edge cases',
  'Out of scope',
  'Technical appendix',
]

const FEATURE_LINE_CAP = 150
const REFERENCE_LINE_CAP = 300

export function checkNestedIndex({ name, root: directory, indexFile, exclude = [], base = root }) {
  const errors = []
  const isExcluded = (file) =>
    exclude.some((entry) => file === entry || file.startsWith(`${entry}${sep}`))
  const label = (file) => relative(base, file)

  const directChildren = (dir) => {
    const files = []
    const folders = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (isExcluded(full)) continue
      if (entry.isDirectory()) {
        if (findMarkdownFiles(full).length > 0) folders.push(full)
      } else if (entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
    return { files, folders }
  }

  // Section folders (`docs/architecture`, `docs/features`) are indexed by the
  // root index itself. Topic folders inside a section own an index.md.
  const sections = directChildren(directory).folders

  const visit = (dir) => {
    const index = join(dir, 'index.md')
    const { files } = directChildren(dir)
    const folders = directChildren(dir).folders.map((folder) => join(folder, 'index.md'))
    const expected = new Set([...files, ...folders])
    expected.delete(index)

    if (!existsSync(index)) {
      errors.push(`${name}: ${label(dir)} has Markdown children but no index.md`)
      return
    }

    const listed = indexTargets(index)
    for (const file of expected) {
      if (!listed.has(file)) {
        errors.push(`${name}: ${label(file)} is not listed in ${label(index)}`)
      }
    }
    for (const file of listed) {
      if (!existsSync(file)) {
        errors.push(`${name}: ${label(index)} links to missing ${label(file)}`)
      }
    }
    for (const folder of directChildren(dir).folders) visit(folder)
  }

  const listed = indexTargets(indexFile)
  const expected = new Set()
  for (const file of directChildren(directory).files) {
    if (file !== indexFile) expected.add(file)
  }
  for (const section of sections) {
    const children = directChildren(section)
    for (const file of children.files) expected.add(file)
    for (const folder of children.folders) {
      const index = join(folder, 'index.md')
      if (existsSync(index)) expected.add(index)
    }
  }

  for (const file of expected) {
    if (!listed.has(file)) {
      errors.push(`${name}: ${label(file)} is not listed in ${label(indexFile)}`)
    }
  }
  for (const file of listed) {
    if (!existsSync(file)) {
      errors.push(`${name}: ${label(indexFile)} links to missing ${label(file)}`)
    }
  }
  for (const section of sections) {
    for (const folder of directChildren(section).folders) visit(folder)
  }

  return errors
}

export function checkFeatureBudgets({
  directory = join(internalRoot, 'features'),
  base = root,
} = {}) {
  const errors = []
  for (const file of findMarkdownFiles(directory)) {
    if (relative(directory, file) === 'GUIDE.md') continue
    const markdown = readFileSync(file, 'utf8')
    const max = isReferenceDoc(markdown) ? REFERENCE_LINE_CAP : FEATURE_LINE_CAP
    const lines = countLines(markdown)
    if (lines > max) {
      errors.push(`internal: ${relative(base, file)} is ${lines} lines (max ${max})`)
    }
  }
  return errors
}

export function checkFeatureShape({
  directory = join(internalRoot, 'features'),
  base = root,
} = {}) {
  const errors = []
  for (const file of findMarkdownFiles(directory)) {
    const withinFeatures = relative(directory, file)
    if (withinFeatures === 'GUIDE.md' || withinFeatures === 'capabilities.md') continue
    const markdown = readFileSync(file, 'utf8')
    if (isReferenceDoc(markdown)) continue
    const headings = new Set(
      [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1].trim())
    )
    for (const heading of REQUIRED_SPEC_HEADINGS) {
      if (!headings.has(heading)) {
        errors.push(`internal: ${relative(base, file)} is missing required heading "## ${heading}"`)
      }
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
    ...checkNestedIndex({
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
    ...checkFeatureBudgets(),
    ...checkFeatureShape(),
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
