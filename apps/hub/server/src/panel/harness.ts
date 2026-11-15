import type { PanelHarness, PanelHarnessState, PanelHarnessTestResult } from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'
import type { HarnessConnection, HarnessProbe } from '../harness/types.ts'

export function toPanelHarness(connection: HarnessConnection): PanelHarness {
  return {
    id: connection.id,
    harnessId: connection.harnessId,
    kind: connection.kind,
    label: connection.label,
    transport: connection.transport,
    online: connection.online,
    ...(connection.fingerprint ? { fingerprint: connection.fingerprint } : {}),
    ...(connection.adapterVersion ? { adapterVersion: connection.adapterVersion } : {}),
    ...(connection.protocolVersion !== undefined
      ? { protocolVersion: connection.protocolVersion }
      : {}),
    ...(connection.harnessVersion ? { harnessVersion: connection.harnessVersion } : {}),
    ...(connection.capabilities ? { capabilities: connection.capabilities } : {}),
    credentialConfigured: connection.credentialConfigured,
    ...(connection.lastTestAt !== undefined
      ? {
          lastTestAt: new Date(connection.lastTestAt).toISOString(),
          lastTestOk: connection.lastTestOk,
        }
      : {}),
    ...(connection.lastTestError ? { lastTestError: connection.lastTestError } : {}),
    ...(connection.lastSeenAt !== undefined
      ? { lastSeenAt: new Date(connection.lastSeenAt).toISOString() }
      : {}),
    createdAt: new Date(connection.createdAt).toISOString(),
    updatedAt: new Date(connection.updatedAt).toISOString(),
  }
}

export function harnessState(
  manager: HarnessManager,
  control: { desired: boolean; effective: boolean }
): PanelHarnessState {
  const connections = manager.list()
  return {
    configured: manager.configured,
    paired: connections.length,
    online: connections.filter((connection) => connection.online).length,
    desired: control.desired,
    effective: control.effective,
    ...(manager.lastError ? { error: manager.lastError } : {}),
  }
}

export function harnessList(manager: HarnessManager): PanelHarness[] {
  return manager.list().map(toPanelHarness)
}

export function toPanelHarnessTest(probe: HarnessProbe): PanelHarnessTestResult {
  return {
    ok: probe.ok,
    code: probe.code,
    ...(probe.message ? { message: probe.message } : {}),
    ...(probe.version ? { version: probe.version } : {}),
    ...(probe.status !== undefined ? { status: probe.status } : {}),
    latencyMs: probe.latencyMs,
    checkedAt: new Date().toISOString(),
  }
}
