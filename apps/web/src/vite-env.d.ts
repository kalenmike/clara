/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected from package.json by Vite. */
  readonly CLARA_VERSION: string
  /** Injected by Vite at dev-server start or build time. */
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
