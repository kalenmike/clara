import type { PanelInstallHostInput, PanelInstallManifest } from '@clara/shared-types'
import { InstallRequestError } from './errors.ts'
import type { AdapterInstallMethod, InstallPlan, InstallPlanInput } from './types.ts'

const HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/
const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SSH_USER = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/
const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const KIND = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Adapters the client can install from a registry manifest. */
export const INSTALL_KINDS = ['opencode', 'claude', 'pi'] as const

export type SshInstallTarget = {
  destination: string
  label: string
  port?: number
  alias?: string
}

export type DockerInstallTarget = {
  container: string
  label: string
}

export type InstallScriptInput = {
  kind: string
  manifest: PanelInstallManifest
  installUrl: string
  pairingCode: string
  opencodeUrl?: string
}

export function validateKind(kind: unknown): string {
  if (typeof kind !== 'string' || !KIND.test(kind)) {
    throw new InstallRequestError(400, 'invalid_kind', 'Choose a supported harness adapter')
  }
  return kind
}

export function installLabel(kind: string): string {
  if (kind === 'opencode') return 'OpenCode'
  if (kind === 'claude') return 'Claude Code'
  if (kind === 'pi') return 'Pi'
  return kind
}

export function validateOpencodeUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new InstallRequestError(400, 'invalid_opencode_url', 'The OpenCode URL must be a string')
  }
  const text = value.trim()
  const unsafe = [...text].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f || /\s/.test(character)
  })
  if (!text || text.length > 2_048 || unsafe) {
    throw new InstallRequestError(400, 'invalid_opencode_url', 'The OpenCode URL is invalid')
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new InstallRequestError(400, 'invalid_opencode_url', 'Enter a valid OpenCode URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InstallRequestError(400, 'invalid_opencode_url', 'The OpenCode URL must use HTTP(S)')
  }
  if (url.username || url.password) {
    throw new InstallRequestError(
      400,
      'invalid_opencode_url',
      'The OpenCode URL must not contain credentials'
    )
  }
  if (url.search || url.hash) {
    throw new InstallRequestError(
      400,
      'invalid_opencode_url',
      'The OpenCode URL must not contain a query or fragment'
    )
  }
  return url.toString().replace(/\/+$/, '')
}

export function validateSshTarget(input: PanelInstallHostInput | undefined): SshInstallTarget {
  if (!input || typeof input !== 'object') {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'Choose an SSH host')
  }
  if (input.alias !== undefined) {
    if (typeof input.alias !== 'string' || !SSH_ALIAS.test(input.alias)) {
      throw new InstallRequestError(400, 'invalid_ssh_target', 'The SSH host alias is invalid')
    }
    return { destination: input.alias, label: input.alias, alias: input.alias }
  }

  const hostname = typeof input.hostname === 'string' ? input.hostname.trim() : ''
  if (!hostname || !HOSTNAME.test(hostname) || hostname.startsWith('-')) {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'Enter a valid SSH hostname or IP')
  }
  const user = input.user === undefined ? undefined : String(input.user).trim()
  if (user !== undefined && (!user || !SSH_USER.test(user))) {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'Enter a valid SSH username')
  }
  const port = input.port
  if (
    port !== undefined &&
    (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'The SSH port must be 1-65535')
  }

  const bracketed = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  const destination = user ? `${user}@${bracketed}` : bracketed
  return {
    destination,
    label: destination,
    ...(port !== undefined ? { port } : {}),
  }
}

export function validateDockerTarget(value: unknown): DockerInstallTarget {
  if (typeof value !== 'string' || !CONTAINER.test(value)) {
    throw new InstallRequestError(400, 'invalid_container', 'Choose a Docker container')
  }
  return { container: value, label: value }
}

/**
 * The remote shell script. It downloads the adapter install script, verifies
 * its SHA-256, then runs it with the pairing code. The adapter artifact itself
 * is downloaded and verified by that script.
 */
/** How long the install waits for the adapter to authenticate with the hub. */
const START_TIMEOUT_SECONDS = 60

export function buildInstallScript(input: InstallScriptInput): string {
  const args = ['--pair', input.pairingCode]
  if (input.kind === 'opencode') args.push('--no-runner')
  if (input.opencodeUrl) args.push('--opencode-url', input.opencodeUrl)

  return [
    'set -eu',
    'download() {',
    '  if command -v curl >/dev/null 2>&1; then',
    '    curl -fsSL --proto "=https" --tlsv1.2 --connect-timeout 10 --max-time 300 "$1" -o "$2"',
    '  elif command -v wget >/dev/null 2>&1; then',
    '    wget -qO "$2" "$1"',
    '  else',
    '    echo "Clara needs curl or wget on this machine to download the adapter installer." >&2',
    '    return 1',
    '  fi',
    '}',
    'sha256() {',
    '  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk \'{print $1}\';',
    '  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk \'{print $1}\';',
    '  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk \'{print $NF}\';',
    '  else echo "Clara needs sha256sum, shasum, or openssl to verify the adapter installer." >&2; return 1; fi',
    '}',
    'tmp=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/clara-install-$$")',
    'trap \'rm -f "$tmp"\' EXIT HUP INT TERM',
    `download ${shellQuote(input.installUrl)} "$tmp"`,
    `expected=${shellQuote(input.manifest.installSha256)}`,
    'actual=$(sha256 "$tmp") || exit 1',
    'if [ "$actual" != "$expected" ]; then',
    '  echo "The adapter installer checksum did not match." >&2',
    '  exit 1',
    'fi',
    `sh "$tmp" ${args.map(shellQuote).join(' ')}`,
    '',
    '# The installer starts a service or a background process when it can, but a',
    '# clean exit does not prove the adapter stayed up. Start it (idempotent) and',
    '# wait for the hub link before reporting success.',
    `kind=${shellQuote(input.kind)}`,
    `version=${shellQuote(input.manifest.version)}`,
    'base="${CLARA_ADAPTER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}}"',
    'data="${CLARA_ADAPTER_DATA_DIR:-$base/clara/adapters/$kind}"',
    'root="$base/clara/adapters/$kind/$version"',
    'binary="$root/clara-adapter-$kind"',
    'if [ -x "$binary" ]; then',
    '  "$binary" start || true',
    'fi',
    'tries=0',
    `while [ "$tries" -lt ${START_TIMEOUT_SECONDS} ]; do`,
    '  pid=$(cat "$data/adapter.pid" 2>/dev/null | tr -cd \'0-9\' || true)',
    '  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && \\',
    '     grep -Eq "\\"pid\\":[[:space:]]*$pid([^0-9]|$)" "$data/state.json" 2>/dev/null && \\',
    '     grep -Eq \'"status":[[:space:]]*"authenticated"\' "$data/state.json" 2>/dev/null; then',
    '    echo "Clara $kind adapter installed and connected."',
    '    exit 0',
    '  fi',
    '  tries=$((tries + 1))',
    '  sleep 1',
    'done',
    'echo "The adapter was installed but did not start or connect." >&2',
    'if [ -f "$data/state.json" ]; then cat "$data/state.json" >&2; fi',
    'if [ -f "$data/adapter.log" ]; then tail -n 80 "$data/adapter.log" >&2; fi',
    'echo "Run: $binary start" >&2',
    'exit 1',
  ].join('\n')
}

export function sshInvocation(target: SshInstallTarget, script: string): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
  ]
  if (target.port !== undefined) args.push('-p', String(target.port))
  args.push(target.destination, script)
  return args
}

export function dockerInvocation(target: DockerInstallTarget, script: string): string[] {
  return ['exec', target.container, 'sh', '-lc', script]
}

/**
 * Turn a pairing code and a registry manifest into the exact command the client
 * should run. Local installs use the same checksummed shell script so all three
 * targets share one execution path.
 */
export function buildInstallPlan(input: InstallPlanInput): InstallPlan {
  const script = buildInstallScript({
    kind: input.kind,
    manifest: input.manifest,
    installUrl: input.manifest.install,
    pairingCode: input.pairingCode,
    ...(input.opencodeUrl ? { opencodeUrl: input.opencodeUrl } : {}),
  })

  if (input.method === 'local') {
    return { command: 'sh', args: ['-c', script], target: 'this machine', script }
  }
  if (input.method === 'ssh') {
    const host = validateSshTarget(input.host)
    return {
      command: 'ssh',
      args: sshInvocation(host, script),
      target: host.label,
      script,
    }
  }
  const docker = validateDockerTarget(input.container)
  return {
    command: 'docker',
    args: dockerInvocation(docker, script),
    target: docker.label,
    script,
  }
}

export function isAdapterInstallMethod(value: unknown): value is AdapterInstallMethod {
  return value === 'local' || value === 'ssh' || value === 'docker'
}

export function quoteShellArgument(value: string): string {
  return shellQuote(value)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
