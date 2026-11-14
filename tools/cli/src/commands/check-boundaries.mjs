import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { root } from '../lib/router.mjs'

/**
 * Harness SDKs may only appear inside their own adapter. Adding a third
 * harness means adding one rule here, not loosening an existing one.
 */
const rules = [
  {
    specifier: '@opencode/client',
    allowed: ['apps/adapters/opencode'],
  },
  {
    specifier: '@anthropic-ai/claude-agent-sdk',
    allowed: ['apps/adapters/claude'],
  },
]

const roots = ['apps', 'packages', 'tools']
const skippedDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])

const cloudflareFeaturePattern = /features\/cloudflare-deployment\/(?!loader\.(?:ts|tsx))/
const cloudflareFeatureRoots = [
  'apps/hub/server/src/features/cloudflare-deployment',
  'apps/hub/panel/src/features/cloudflare-deployment',
]

const violations = []

function isAllowed(path, allowed) {
  return allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}${sep}`))
}

function normalize(path) {
  return path.split(sep).join('/')
}

function checkSource(path, relativePath, specifier) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return
  const source = readFileSync(path, 'utf8')
  if (importPattern(specifier).test(source)) {
    violations.push(`${normalize(relativePath)} imports ${specifier}`)
  }
}

function checkCloudflareIsolation(path, relativePath) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return
  const inFeature = cloudflareFeatureRoots.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}${sep}`)
  )
  const inTest = relativePath.split(sep).includes('test')
  if (inFeature || inTest) return

  const source = readFileSync(path, 'utf8')
  if (cloudflareFeaturePattern.test(normalize(relativePath + '\n' + source))) {
    violations.push(
      `${normalize(relativePath)} imports the Cloudflare deployment feature outside its loader`
    )
  }
}

function checkManifest(path, relativePath, specifier) {
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
    if (manifest[section]?.[specifier]) {
      violations.push(`${normalize(relativePath)} depends on ${specifier}`)
    }
  }
}

function importPattern(specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:from\\s+['"]${escaped}['"]|import\\s*\\(\\s*['"]${escaped}['"]|require\\s*\\(\\s*['"]${escaped}['"]\\s*\\))`
  )
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
    checkCloudflareIsolation(path, relativePath)
    for (const rule of rules) {
      if (isAllowed(relativePath, rule.allowed)) continue
      checkSource(path, relativePath, rule.specifier)
      checkManifest(path, relativePath, rule.specifier)
    }
  }
}

for (const directory of roots) {
  try {
    walk(join(root, directory))
  } catch {
    // A workspace may not exist in every checkout.
  }
}

for (const relativePath of [
  'apps/hub/server/src/api/routes',
  'apps/hub/server/src/harness',
  'apps/hub/server/src/push',
]) {
  const directory = join(root, relativePath)
  try {
    const files = readdirSync(directory)
    for (const file of files) {
      if (!file.endsWith('.ts')) continue
      const source = readFileSync(join(directory, file), 'utf8')
      if (/['"`]\/api\//.test(source)) {
        violations.push(`${relativePath}/${file} contains an OpenCode /api/ path`)
      }
    }
  } catch {
    // The directory may not exist in every checkout.
  }
}

if (violations.length > 0) {
  console.error('Source boundary violations:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log('Source boundaries are clean.')
