import {
  INSTALL_KINDS,
  InstallRequestError,
  isAdapterInstallMethod,
  validateKind,
  validateOpencodeUrl,
  type AdapterInstallMethod,
} from '@clara/adapter-install'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  parseHarnessPairingInput,
  type PanelInstallHostInput,
  type PanelInstallManifest,
} from '@clara/shared-types'

export type InstallRequest = {
  kind: string
  method: AdapterInstallMethod
  pairingCode: string
  manifest: PanelInstallManifest
  host?: PanelInstallHostInput
  container?: string
  opencodeUrl?: string
}

const SHA256 = /^[a-f0-9]{64}$/i

export function parseInstallRequest(value: unknown): InstallRequest {
  if (!isRecord(value)) {
    throw new InstallRequestError(400, 'invalid_body', 'Use a JSON object')
  }
  const kind = validateKind(value.kind)
  if (!(INSTALL_KINDS as readonly string[]).includes(kind)) {
    throw new InstallRequestError(400, 'invalid_kind', 'Choose a supported harness adapter')
  }
  if (!isAdapterInstallMethod(value.method)) {
    throw new InstallRequestError(400, 'invalid_method', 'Choose local, SSH, or Docker')
  }
  const pairingCode = typeof value.pairingCode === 'string' ? value.pairingCode.trim() : ''
  if (!pairingCode.startsWith(HARNESS_PAIRING_CODE_PREFIX) || pairingCode.length > 8_192) {
    throw new InstallRequestError(400, 'invalid_pairing_code', 'The pairing code is invalid')
  }
  const pairing = parseHarnessPairingInput(pairingCode)
  if (!pairing || pairing.kind !== kind) {
    throw new InstallRequestError(
      400,
      'invalid_pairing_code',
      `That pairing code is not for ${kind}.`
    )
  }

  const manifest = parseManifest(value.manifest, kind)
  const opencodeUrl = validateOpencodeUrl(value.opencodeUrl)
  const host = value.host === undefined ? undefined : parseHost(value.host)
  const container = value.container === undefined ? undefined : String(value.container)
  if (value.method === 'ssh' && !host) {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'Choose an SSH host')
  }
  if (value.method === 'docker' && !container) {
    throw new InstallRequestError(400, 'invalid_container', 'Choose a Docker container')
  }

  return {
    kind,
    method: value.method,
    pairingCode,
    manifest,
    ...(host ? { host } : {}),
    ...(container ? { container } : {}),
    ...(opencodeUrl ? { opencodeUrl } : {}),
  }
}

function parseManifest(value: unknown, kind: string): PanelInstallManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.harness !== kind) {
    throw new InstallRequestError(400, 'invalid_manifest', 'The adapter manifest is invalid')
  }
  const install = typeof value.install === 'string' ? value.install.trim() : ''
  const installSha256 = typeof value.installSha256 === 'string' ? value.installSha256.trim() : ''
  if (!install.startsWith('https://') || !SHA256.test(installSha256)) {
    throw new InstallRequestError(400, 'invalid_manifest', 'The adapter manifest is invalid')
  }
  if (!isRecord(value.artifacts)) {
    throw new InstallRequestError(400, 'invalid_manifest', 'The adapter manifest is invalid')
  }
  return {
    schemaVersion: 1,
    harness: kind,
    version: typeof value.version === 'string' ? value.version : '',
    ...(typeof value.publishedAt === 'string' ? { publishedAt: value.publishedAt } : {}),
    install,
    installSha256,
    artifacts: parseArtifacts(value.artifacts),
  }
}

function parseArtifacts(value: Record<string, unknown>): PanelInstallManifest['artifacts'] {
  const artifacts: PanelInstallManifest['artifacts'] = {}
  for (const [platform, artifact] of Object.entries(value)) {
    if (!isRecord(artifact)) continue
    const url = typeof artifact.url === 'string' ? artifact.url : ''
    const sha256 = typeof artifact.sha256 === 'string' ? artifact.sha256 : ''
    if (!url || !SHA256.test(sha256)) continue
    artifacts[platform] = {
      url,
      sha256,
      ...(typeof artifact.size === 'number' ? { size: artifact.size } : {}),
    }
  }
  return artifacts
}

function parseHost(value: unknown): PanelInstallHostInput {
  if (!isRecord(value)) {
    throw new InstallRequestError(400, 'invalid_ssh_target', 'Choose an SSH host')
  }
  return {
    ...(typeof value.alias === 'string' ? { alias: value.alias } : {}),
    ...(typeof value.hostname === 'string' ? { hostname: value.hostname } : {}),
    ...(typeof value.user === 'string' ? { user: value.user } : {}),
    ...(typeof value.port === 'number' ? { port: value.port } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
