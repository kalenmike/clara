import { createContext, useContext } from 'react'
import type {
  AdapterInstallJob,
  AdapterInstallMethod,
  PanelInstallDockerTargets,
  PanelInstallHostInput,
  PanelInstallManifest,
  PanelInstallSshTargets,
} from '@clara/shared-types'

/** The targets a client-side adapter host can discover on its own machine. */
export type PanelAdapterHostTargets = {
  ssh: PanelInstallSshTargets
  docker: PanelInstallDockerTargets
}

export type PanelAdapterInstallInput = {
  kind: string
  method: AdapterInstallMethod
  pairingCode: string
  manifest: PanelInstallManifest
  host?: PanelInstallHostInput
  container?: string
  opencodeUrl?: string
}

/**
 * The loopback adapter host a client shell can lend to the panel. The
 * hub-served panel has none; the bundled desktop panel supplies one so the
 * same pairing flow can run local, SSH, and Docker installs.
 */
export type PanelAdapterHost = {
  targets: () => Promise<PanelAdapterHostTargets>
  start: (input: PanelAdapterInstallInput) => Promise<AdapterInstallJob>
  job: (id: string) => Promise<AdapterInstallJob>
  cancel: (id: string) => Promise<void>
}

/**
 * Host capabilities the panel cannot infer from the hub snapshot. The default
 * transport describes the connection carrying the panel: a remote client should
 * not hand out the hub's loopback address by default.
 */
export type PanelRuntime = {
  adapterHost?: PanelAdapterHost
  defaultTransport?: 'local' | 'relay'
}

export const DEFAULT_PANEL_RUNTIME: PanelRuntime = { defaultTransport: 'local' }

export const PanelRuntimeContext = createContext<PanelRuntime>(DEFAULT_PANEL_RUNTIME)

export function usePanelRuntime(): PanelRuntime {
  return useContext(PanelRuntimeContext)
}

export function usePanelAdapterHost(): PanelAdapterHost | undefined {
  return usePanelRuntime().adapterHost
}
