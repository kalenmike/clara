import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, delimiter } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type ClaudeInstallation = {
  binary: string
  source: 'configured' | 'path' | 'sdk'
}

export type ClaudeAuth = {
  loggedIn: boolean
  authMethod?: string
  apiProvider?: string
  apiKeySource?: string
  projectsDirectory?: string
  configDirectory?: string
  loginExpiresAt?: string | null
}

type SdkManifest = {
  version?: string
  claudeCodeVersion?: string
  optionalDependencies?: Record<string, string>
}

export function sdkManifest(): SdkManifest | undefined {
  const root = sdkRoot()
  if (!root) return undefined
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as SdkManifest
  } catch {
    return undefined
  }
}

export function sdkRoot(): string | undefined {
  try {
    const main = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    return dirname(main)
  } catch {
    return undefined
  }
}

/** Resolve the Agent SDK's bundled Claude Code binary for this platform. */
export function resolveBundledBinary(): string | undefined {
  const root = sdkRoot()
  if (!root) return undefined
  let sdkRequire: NodeJS.Require
  try {
    sdkRequire = createRequire(join(root, 'package.json'))
  } catch {
    return undefined
  }

  const manifest = sdkManifest()
  const platform = `${process.platform}-${process.arch}`
  const preferred = `@anthropic-ai/claude-agent-sdk-${platform}`
  const candidates = [
    preferred,
    ...(process.platform === 'linux' ? [`${preferred}-musl`] : []),
    ...Object.keys(manifest?.optionalDependencies ?? {}).filter((name) =>
      name.startsWith('@anthropic-ai/claude-agent-sdk-')
    ),
  ]

  const seen = new Set<string>()
  for (const name of candidates) {
    if (seen.has(name)) continue
    seen.add(name)
    try {
      const manifestPath = sdkRequire.resolve(`${name}/package.json`)
      const binary = join(
        dirname(manifestPath),
        process.platform === 'win32' ? 'claude.exe' : 'claude'
      )
      if (existsSync(binary)) return binary
    } catch {
      // Try the next platform package.
    }
  }
  return undefined
}

export function findOnPath(name: string): string | undefined {
  const path = process.env.PATH
  if (!path) return undefined
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const directory of path.split(delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not executable here.
      }
    }
  }
  return undefined
}

/**
 * Prefer an explicit path, then CLAUDE_CODE_PATH, then the system binary, then
 * the SDK's pinned binary. The SDK binary is preferred over an older PATH
 * install only when the user has not asked for a system binary.
 */
export function detectClaudeInstallation(configuredPath?: string): ClaudeInstallation | undefined {
  const explicit = configuredPath ?? process.env.CLAUDE_CODE_PATH?.trim()
  if (explicit) return { binary: explicit, source: 'configured' }

  const system = findOnPath('claude')
  if (system) return { binary: system, source: 'path' }

  const bundled = resolveBundledBinary()
  if (bundled) return { binary: bundled, source: 'sdk' }
  return undefined
}

export function parseClaudeVersion(output: string): string | undefined {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)
  return match?.[1]
}

export async function readClaudeVersion(
  binary: string,
  timeoutMs = 2_000
): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await run(binary, ['--version'], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    })
    return parseClaudeVersion(`${stdout}\n${stderr}`)
  } catch {
    return undefined
  }
}

/** `claude auth status` is a local check; it does not call the model. */
export async function readClaudeAuth(
  binary: string,
  timeoutMs = 3_000
): Promise<ClaudeAuth | undefined> {
  let stdout: string
  try {
    stdout = (
      await run(binary, ['auth', 'status'], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      })
    ).stdout
  } catch (cause) {
    // `auth status` exits non-zero when signed out but still prints the
    // status payload, so parse stdout from the rejection before giving up.
    const failed = cause as { stdout?: unknown }
    if (typeof failed.stdout !== 'string' || !failed.stdout.trim()) return undefined
    stdout = failed.stdout
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as Partial<ClaudeAuth>
    return {
      loggedIn: parsed.loggedIn === true,
      ...(typeof parsed.authMethod === 'string' ? { authMethod: parsed.authMethod } : {}),
      ...(typeof parsed.apiProvider === 'string' ? { apiProvider: parsed.apiProvider } : {}),
      ...(typeof parsed.apiKeySource === 'string' ? { apiKeySource: parsed.apiKeySource } : {}),
      ...(typeof parsed.projectsDirectory === 'string'
        ? { projectsDirectory: parsed.projectsDirectory }
        : {}),
      ...(typeof parsed.configDirectory === 'string'
        ? { configDirectory: parsed.configDirectory }
        : {}),
      ...(parsed.loginExpiresAt === null || typeof parsed.loginExpiresAt === 'string'
        ? { loginExpiresAt: parsed.loginExpiresAt }
        : {}),
    }
  } catch {
    return undefined
  }
}

export function describeBinary(binary: string): string {
  return basename(binary)
}
