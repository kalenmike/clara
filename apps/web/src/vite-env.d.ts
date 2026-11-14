/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional relay or local hub WebSocket base. Empty uses the pairing payload URL. */
  readonly VITE_CLARA_WS_URL?: string
  /** Injected from package.json by Vite. */
  readonly CLARA_VERSION: string
  /** True in the Tauri desktop build (Vite `desktop` mode). */
  readonly CLARA_DESKTOP: boolean
  /** Injected by Vite at dev-server start or build time. */
  readonly CLARA_BUILD: {
    mode: 'dev' | 'build'
    surface: 'web' | 'desktop'
    commit: string | null
    dirty: boolean
    builtAt: string
  }
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
