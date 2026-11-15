import type { ClaraRole } from '../state/role.ts'

/**
 * The adapter host is deliberately read-only for the Clara services. These
 * messages keep a local command from starting or probing a second stack.
 */
export function stackGuard(role: ClaraRole, command: string): string | undefined {
  if (role !== 'adapter') return undefined
  return [
    'The Clara services run on another machine (the hub host).',
    `\`clara ${command}\` only manages services on this machine.`,
    'Run it on the hub host, or run `clara setup` here to make this machine a hub host.',
  ].join('\n')
}

export function logsGuard(role: ClaraRole): string | undefined {
  if (role !== 'adapter') return undefined
  return [
    'Service logs are on the hub host.',
    'Run `clara logs` there, or follow a local adapter log with `clara adapter logs <kind>`.',
  ].join('\n')
}

export function pairingGuard(role: ClaraRole, target: 'hub' | 'adapter'): string | undefined {
  if (role !== 'adapter') return undefined
  if (target === 'hub') {
    return [
      'Browser pairing codes are issued by the hub.',
      'Run `clara pair hub` on the hub host and open the link on the device you want to pair.',
    ].join('\n')
  }
  return [
    'Adapter pairing codes are issued by the hub.',
    'Run `clara pair adapter --harness <kind>` on the hub host, then pass the code to',
    '`clara adapter install <kind> --pair <code>` on this machine.',
  ].join('\n')
}

export function adapterInstallGuard(role: ClaraRole, kind: string): string | undefined {
  if (role !== 'adapter') return undefined
  return [
    'This machine has no hub to issue a pairing code.',
    `Run \`clara pair adapter --harness ${kind}\` on the hub host, then:`,
    `  clara adapter install ${kind} --pair <code>`,
  ].join('\n')
}

export function serviceInstallGuard(role: ClaraRole): string | undefined {
  if (role !== 'adapter') return undefined
  return [
    'The Clara services run on another machine; there is no stack login service to install here.',
    'Manage adapter services with `clara adapter start <kind>` and `clara adapter stop <kind>`.',
  ].join('\n')
}

export function runnerStartGuard(role: ClaraRole): string | undefined {
  if (role !== 'adapter') return undefined
  return [
    "The shared runner executes against the hub host's engine.",
    'Start it on the hub host. The adapter-installed runner is visible with `clara runner status`.',
  ].join('\n')
}
