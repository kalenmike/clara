import type { PanelHarness, PanelHarnessState, PanelHarnessTestResult } from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'
import type { HarnessConnection, HarnessProbe } from '../harness/types.ts'

export function toPanelHarness(connection: HarnessConnection): PanelHarness {
  return {
    id: connection.id,
    kind: connection.kind,
    label: connection.label,
    baseUrl: connection.baseUrl,
    authType: connection.authType,
    ...(connection.username ? { username: connection.username } : {}),
    options: connection.options,
    isActive: connection.isActive,
    secretConfigured: connection.secretConfigured,
    ...(connection.lastTestAt !== undefined
      ? {
          lastTestAt: new Date(connection.lastTestAt).toISOString(),
          lastTestOk: connection.lastTestOk,
        }
      : {}),
    ...(connection.lastTestError ? { lastTestError: connection.lastTestError } : {}),
    createdAt: new Date(connection.createdAt).toISOString(),
    updatedAt: new Date(connection.updatedAt).toISOString(),
  }
}

export function harnessState(manager: HarnessManager): PanelHarnessState {
  const active = manager.active
  return {
    configured: manager.configured,
    ...(active ? { activeId: active.id } : {}),
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
