import { bold, cyan, dim, yellow } from '../ui/color.ts'
import { formatDuration, stateLabel } from '../ui/index.ts'
import type { Column } from '../ui/table.ts'
import type { ServiceStatus } from './lifecycle.ts'

export type StatusExpectation = {
  /** Version this command ships as. */
  version: string
  /** Wire protocol this command speaks. */
  protocol: number
}

/** Columns for the status table; reported values are compared with this command. */
export function statusColumns(expected: StatusExpectation): Column<ServiceStatus>[] {
  return [
    { header: 'SERVICE', value: (service) => bold(service.name) },
    { header: 'STATE', value: (service) => stateLabel(service.state) },
    { header: 'ENDPOINT', value: (service) => cyan(service.url) },
    { header: 'VERSION', value: (service) => versionCell(service, expected) },
    { header: 'PROTOCOL', value: (service) => protocolCell(service, expected), align: 'right' },
    {
      header: 'PID',
      value: (service) => (service.pid ? String(service.pid) : '-'),
      align: 'right',
    },
    {
      header: 'UPTIME',
      value: (service) => (service.uptimeMs ? formatDuration(service.uptimeMs) : '-'),
      align: 'right',
    },
  ]
}

/**
 * One line explaining a `*` marker. A running service reports the version and
 * protocol of the build it actually loaded, which can lag the installed
 * command until the stack restarts.
 */
export function mismatchNote(
  services: readonly ServiceStatus[],
  expected: StatusExpectation
): string | undefined {
  const mismatched = services.some(
    (service) => versionMismatch(service, expected) || protocolMismatch(service, expected)
  )
  if (!mismatched) return undefined
  return `${yellow('*')} ${dim('a running service differs from this command; restart the stack to load the installed build.')}`
}

function versionCell(service: ServiceStatus, expected: StatusExpectation): string {
  if (service.version === undefined) return '-'
  return versionMismatch(service, expected) ? yellow(`${service.version}*`) : service.version
}

function protocolCell(service: ServiceStatus, expected: StatusExpectation): string {
  if (service.protocol === undefined) return '-'
  const value = String(service.protocol)
  return protocolMismatch(service, expected) ? yellow(`${value}*`) : value
}

function versionMismatch(service: ServiceStatus, expected: StatusExpectation): boolean {
  // An unknown command version cannot judge a service; a source checkout
  // without a manifest reports 0.0.0.
  if (expected.version === '0.0.0') return false
  return service.version !== undefined && service.version !== expected.version
}

function protocolMismatch(service: ServiceStatus, expected: StatusExpectation): boolean {
  return service.protocol !== undefined && service.protocol !== expected.protocol
}
