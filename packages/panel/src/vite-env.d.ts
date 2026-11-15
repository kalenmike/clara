/** Build-time switch for the optional Cloudflare relay deployment feature. */
declare const __CLARA_CLOUDFLARE_DEPLOYMENT__: boolean

interface ImportMetaEnv {
  /** Injected by the host Vite config: a release version or a dev version. */
  readonly CLARA_VERSION: string
  /** Injected by the host Vite config at dev-server start or build time. */
  readonly CLARA_BUILD: {
    mode: 'dev' | 'build'
    commit: string | null
    dirty: boolean
    builtAt: string
  }
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
