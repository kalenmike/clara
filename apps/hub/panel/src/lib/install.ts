import type {
  PanelInstallInfo,
  PanelInstallJob,
  PanelInstallManifest,
  PanelInstallResponse,
  PanelInstallStart,
} from '@clara/shared-types'
import { deletePanel, getPanel, postPanel } from './panel-api.ts'

export async function fetchInstallInfo(): Promise<PanelInstallInfo> {
  return getPanel<PanelInstallInfo>('/panel/api/v1/install')
}

export async function startInstall(input: PanelInstallStart): Promise<PanelInstallResponse> {
  return postPanel<PanelInstallResponse>('/panel/api/v1/install', input)
}

export async function fetchInstallJob(id: string): Promise<PanelInstallJob> {
  return getPanel<PanelInstallJob>(`/panel/api/v1/install/jobs/${encodeURIComponent(id)}`)
}

export async function cancelInstallJob(id: string): Promise<void> {
  await deletePanel(`/panel/api/v1/install/jobs/${encodeURIComponent(id)}`)
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

export function repoCommand(kind: string, code: string): string {
  return `pnpm clara adapter install --${kind} --pair ${code}`
}

export function supportedPlatforms(manifest: PanelInstallManifest | undefined): string[] {
  return manifest ? Object.keys(manifest.artifacts).sort() : []
}
