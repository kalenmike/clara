/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `0` to exclude the experimental Clara management feature. */
  readonly VITE_CLARA_MANAGEMENT?: string
}
