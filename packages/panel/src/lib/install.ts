import type {
  AdapterInstallOffer,
  AdapterInstallOfferInput,
  PanelHarness,
  PanelInstallInfo,
  PanelInstallManifest,
} from '@clara/shared-types'
import { isAdapterUpdateAvailable } from '@clara/shared-types'
import { getPanel, postPanel } from './panel-api.ts'

/**
 * Reads the registry status. Pass `refresh` for a user-initiated check so the
 * hub re-reads the manifests instead of answering from its cache.
 */
export async function fetchInstallInfo(
  options: { refresh?: boolean } = {}
): Promise<PanelInstallInfo> {
  const path = options.refresh ? '/panel/api/v1/install?refresh=true' : '/panel/api/v1/install'
  return getPanel<PanelInstallInfo>(path)
}

/** Issue a one-time adapter pairing plus the command and desktop deep link. */
export async function createAdapterOffer(
  input: AdapterInstallOfferInput
): Promise<AdapterInstallOffer> {
  return postPanel<AdapterInstallOffer>('/panel/api/v1/install', input)
}

/** The most recent time the hub read the registry, for the checked status line. */
export function registryCheckedAt(info: PanelInstallInfo | undefined): string | undefined {
  let latest: number | undefined
  let value: string | undefined
  for (const entry of info?.registry.entries ?? []) {
    const time = new Date(entry.checkedAt).getTime()
    if (Number.isNaN(time)) continue
    if (latest === undefined || time > latest) {
      latest = time
      value = entry.checkedAt
    }
  }
  return value
}

export function installManifest(
  info: PanelInstallInfo | undefined,
  kind: string
): PanelInstallManifest | undefined {
  const entry = info?.registry.entries.find((item) => item.kind === kind)
  return entry?.ok ? entry.manifest : undefined
}

export function registryError(
  info: PanelInstallInfo | undefined,
  kind: string
): string | undefined {
  return info?.registry.entries.find((item) => item.kind === kind)?.error
}

export function registryCommand(
  info: PanelInstallInfo | undefined,
  kind: string,
  code: string
): string | undefined {
  const manifest = installManifest(info, kind)
  if (!manifest) return undefined
  return `curl -fsSL ${manifest.install} | ${registryEnv(info)}sh -s -- --pair ${code}`
}

/**
 * A no-CLI recovery command for an adapter that is already paired. It reuses
 * the saved pairing, so no new code is needed, and records the registry for
 * the next self-update.
 */
export function adapterRepairCommand(
  info: PanelInstallInfo | undefined,
  kind: string
): string | undefined {
  const manifest = installManifest(info, kind)
  if (!manifest) return undefined
  return `curl -fsSL ${manifest.install} | ${registryEnv(info)}sh -s -- --reuse-pairing`
}

/** The newer published version for a connected adapter, when one exists. */
export function latestAdapterVersion(
  info: PanelInstallInfo | undefined,
  kind: string
): string | undefined {
  return installManifest(info, kind)?.version
}

/**
 * Whether a connected adapter is behind the published release. Development
 * builds use the release timestamp, not the commit hash.
 */
export function adapterUpdate(
  info: PanelInstallInfo | undefined,
  connection: Pick<PanelHarness, 'kind' | 'adapterVersion' | 'adapterInstalledAt'>
): { latest: string | undefined; available: boolean } {
  const manifest = installManifest(info, connection.kind)
  const latest = manifest?.version
  return {
    latest,
    available: isAdapterUpdateAvailable({
      current: connection.adapterVersion,
      latest,
      currentAt: connection.adapterInstalledAt,
      latestAt: manifest?.publishedAt,
    }),
  }
}

function registryEnv(info: PanelInstallInfo | undefined): string {
  const base = info?.registry.baseUrl
  return base ? `CLARA_ADAPTER_REGISTRY_URL=${shellQuote(base)} ` : ''
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Whether the hub can issue an adapter setup offer. */
export function installOffered(info: PanelInstallInfo | undefined): boolean {
  return info?.enabled !== false && info?.available === true
}

export function repoCommand(kind: string, code: string): string {
  return `clara adapter install ${kind} --pair ${code}`
}

export function supportedPlatforms(manifest: PanelInstallManifest | undefined): string[] {
  return manifest ? Object.keys(manifest.artifacts).sort() : []
}
