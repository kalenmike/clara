import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const allowed = new Set(['apps/server', 'apps/lab'])
const roots = ['apps', 'packages']
const skippedDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])
const importPattern =
  /(?:from\s+['"]@opencode\/client['"]|import\s*\(\s*['"]@opencode\/client['"]|require\s*\(\s*['"]@opencode\/client['"]\s*\))/

const violations = []

function isAllowed(path) {
  return [...allowed].some((prefix) => path === prefix || path.startsWith(`${prefix}${sep}`))
}

function normalize(path) {
  return path.split(sep).join('/')
}

function checkSource(path, relativePath) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return
  const source = readFileSync(path, 'utf8')
  if (importPattern.test(source))
    violations.push(`${normalize(relativePath)} imports @opencode/client`)
}

function checkManifest(path, relativePath) {
  if (!path.endsWith('package.json')) return
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    if (manifest[section]?.['@opencode/client']) {
      violations.push(`${normalize(relativePath)} depends on @opencode/client`)
    }
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (skippedDirs.has(entry)) continue
    const path = join(directory, entry)
    const stat = statSync(path)
    const relativePath = relative(root, path)
    if (stat.isDirectory()) {
      walk(path)
      continue
    }
    if (isAllowed(relativePath)) continue
    checkSource(path, relativePath)
    checkManifest(path, relativePath)
  }
}

for (const directory of roots) {
  try {
    walk(join(root, directory))
  } catch {
    // A workspace may not exist in every checkout.
  }
}

if (violations.length > 0) {
  console.error('@opencode/client is only allowed in apps/server and apps/lab:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log('OpenCode type boundary is clean.')
