import type { CloudflareDeployment, CreateCloudflareDeploymentOptions } from './types.ts'

/**
 * The only entry point the hub core imports. When the feature was not built
 * in, esbuild removes the dynamic import below and this resolves to undefined.
 */
export async function loadCloudflareDeploymentFeature(
  options: CreateCloudflareDeploymentOptions
): Promise<CloudflareDeployment | undefined> {
  if (process.env.ENABLE_CLOUDFLARE_DEPLOYMENT === 'true') {
    const { createCloudflareDeployment } = await import('./index.ts')
    return createCloudflareDeployment(options)
  }
  return undefined
}
