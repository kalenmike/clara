import { lazy, type ComponentType } from 'react'
import type { CloudflareRelaySlotProps } from './types.ts'

/**
 * The only module the core panel imports. The dynamic import is removed by
 * Vite when ENABLE_CLOUDFLARE_DEPLOYMENT is not set at build time.
 */
export const CloudflareRelaySlot: ComponentType<CloudflareRelaySlotProps> | undefined =
  __CLARA_CLOUDFLARE_DEPLOYMENT__ ? lazy(() => import('./index.tsx')) : undefined
