import type {
  AdapterInstallOffer,
  AdapterInstallOfferInput,
  PanelInstallInfo,
  PanelInstallManifest,
} from '@clara/shared-types'
import { getPanel, postPanel } from './panel-api.ts'

export async function fetchInstallInfo(): Promise<PanelInstallInfo> {
  return getPanel<PanelInstallInfo>('/panel/api/v1/install')
}

/** Issue a one-time adapter pairing plus the command and desktop deep link. */
export async function createAdapterOffer(
  input: AdapterInstallOfferInput
): Promise<AdapterInstallOffer> {
  return postPanel<AdapterInstallOffer>('/panel/api/v1/install', input)
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
