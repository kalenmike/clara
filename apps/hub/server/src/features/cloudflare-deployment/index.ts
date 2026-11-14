import { createCloudflarePanelFeature } from './panel-routes.ts'
import { CloudflareDeploymentState } from './state.ts'
import type { CloudflareDeployment, CreateCloudflareDeploymentOptions } from './types.ts'

export function createCloudflareDeployment(
  options: CreateCloudflareDeploymentOptions
): CloudflareDeployment {
  const state = new CloudflareDeploymentState(options)
  const panel = createCloudflarePanelFeature(state)

  return {
    panel,
    attachRuntime: (runtime) => state.attachRuntime(runtime),
    forgetDeployment: () => state.forgetDeployment(),
    close: () => {
      // No background resources.
    },
  }
}
