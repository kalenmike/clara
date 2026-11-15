interface ImportMetaEnv {
  /** Injected by the host Vite config (the desktop build or the standalone lab). */
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
