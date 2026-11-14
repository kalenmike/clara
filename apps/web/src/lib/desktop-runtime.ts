import { isDesktop } from './runtime'

type HubRuntime = {
  local?: { wsUrl?: string }
}

type TauriGlobal = {
  core?: {
    invoke?: <T>(command: string) => Promise<T>
  }
}

/**
 * The hub writes its live ports to a local runtime file. The desktop shell,
 * not the webview, reads that file; this asks the shell for the local socket so
 * a port change does not force the user to pair again.
 */
export async function desktopLocalWsUrl(): Promise<string | undefined> {
  if (!isDesktop) return undefined
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
  const invoke = tauri?.core?.invoke
  if (!invoke) return undefined

  try {
    const runtime = await invoke<HubRuntime | null>('hub_runtime')
    const value = runtime?.local?.wsUrl
    return typeof value === 'string' && value.startsWith('ws') ? value : undefined
  } catch {
    return undefined
  }
}
