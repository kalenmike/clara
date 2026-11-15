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
  const noRunner = kind === 'opencode' ? ' --no-runner' : ''
  return `curl -fsSL ${manifest.install} | sh -s -- --pair ${code}${noRunner}`
}

/** Whether the hub can issue an adapter setup offer. */
export function installOffered(info: PanelInstallInfo | undefined): boolean {
  return info?.enabled !== false && info?.available === true
}

export function repoCommand(kind: string, code: string): string {
  return `pnpm clara start adapter --harness ${kind} --pair ${code}`
}

export function supportedPlatforms(manifest: PanelInstallManifest | undefined): string[] {
  return manifest ? Object.keys(manifest.artifacts).sort() : []
}
