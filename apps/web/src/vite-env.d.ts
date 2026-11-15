/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional relay or local hub WebSocket base. Empty uses the pairing payload URL. */
  readonly VITE_CLARA_WS_URL?: string
  /** Injected by Vite: a release version or the checkout's dev version. */
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

/** Injected by Vite: the identity a page and its service worker compare. */
declare const __CLARA_BUILD_ID__: string

/**
 * Build-time switch for the optional Cloudflare relay deployment feature. The
 * panel UI reads it when it is compiled into this app for the `/hub` route.
 */
declare const __CLARA_CLOUDFLARE_DEPLOYMENT__: boolean
