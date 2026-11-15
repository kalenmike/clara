import type {
  AdapterInstallJob,
  PanelInstallDockerTargets,
  PanelInstallHostInput,
  PanelInstallManifest,
  PanelInstallSshTargets,
} from '@clara/shared-types'
import type { PanelAdapterHost } from '@clara/panel'
import { parseAdapterInstallKind, parseAdapterInstallLink } from '@clara/shared-types'
import { isDesktop } from './runtime'

export type AdapterHostMethod = 'local' | 'ssh' | 'docker'

export type AdapterHostTargets = {
  ssh: PanelInstallSshTargets
  docker: PanelInstallDockerTargets
}

export type AdapterHostStartInput = {
  kind: string
  method: AdapterHostMethod
  pairingCode: string
  manifest: PanelInstallManifest
  host?: PanelInstallHostInput
  container?: string
  opencodeUrl?: string
}

type TauriGlobal = {
  core?: {
    invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  }
  event?: {
    listen?: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>
  }
}

function tauri(): TauriGlobal | undefined {
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
}

/** True only in the desktop build with a live Tauri bridge. */
export function adapterHostAvailable(): boolean {
  return isDesktop && Boolean(tauri()?.core?.invoke)
}

type Runtime = { baseUrl: string; token: string }

let runtimePromise: Promise<Runtime | undefined> | undefined

async function runtime(): Promise<Runtime | undefined> {
  const invoke = tauri()?.core?.invoke
  if (!isDesktop || !invoke) return undefined
  runtimePromise ??= invoke<Runtime | null>('adapter_host_runtime')
    .then((value) => value ?? undefined)
    .catch(() => undefined)
  return runtimePromise
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const value = await runtime()
  if (!value) throw new Error('The Clara desktop adapter host is not running.')
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${value.token}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${value.baseUrl}${path}`, { ...init, headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `The adapter host answered ${response.status}.`)
  }
  return (await response.json()) as T
}

export async function listAdapterHostTargets(): Promise<AdapterHostTargets | undefined> {
  if (!adapterHostAvailable()) return undefined
  return request<AdapterHostTargets>('/targets')
}

export async function startAdapterHostInstall(
  input: AdapterHostStartInput
): Promise<AdapterInstallJob> {
  return request<AdapterInstallJob>('/install', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adapterHostJob(id: string): Promise<AdapterInstallJob> {
  return request<AdapterInstallJob>(`/install/${encodeURIComponent(id)}`)
}

export async function cancelAdapterHostInstall(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/install/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export type AdapterHostLink = {
  code: string
  kind?: string
}

function readLink(value: string): AdapterHostLink | undefined {
  const code = parseAdapterInstallLink(value)
  if (!code) return undefined
  const kind = parseAdapterInstallKind(value)
  return { code, ...(kind ? { kind } : {}) }
}

/**
 * The shell stores a `clara://adapter?code=…` link until the webview can ask
 * for it.
 */
export async function takeAdapterHostLink(): Promise<AdapterHostLink | undefined> {
  const invoke = tauri()?.core?.invoke
  if (!isDesktop || !invoke) return undefined
  try {
    const link = await invoke<string | null>('adapter_take_link')
    return link ? readLink(link) : undefined
  } catch {
    return undefined
  }
}

/** Subscribe to links opened while the app is already running. */
export function subscribeAdapterHostLinks(handler: (link: AdapterHostLink) => void): () => void {
  const listen = tauri()?.event?.listen
  if (!isDesktop || !listen) return () => {}
  let disposed = false
  let unlisten: (() => void) | undefined
  void listen<string>('adapter-link', (event) => {
    const link = readLink(event.payload)
    if (link) handler(link)
  }).then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  })
  return () => {
    disposed = true
    unlisten?.()
  }
}

/**
 * The adapter host as the hub panel consumes it. Only the desktop build has a
 * live Tauri bridge; every other surface keeps the panel's copy-command path.
 */
export const desktopAdapterHost: PanelAdapterHost = {
  targets: async () => {
    const value = await listAdapterHostTargets()
    if (!value) throw new Error('The Clara desktop adapter host is not running.')
    return value
  },
  start: startAdapterHostInstall,
  job: adapterHostJob,
  cancel: cancelAdapterHostInstall,
}
