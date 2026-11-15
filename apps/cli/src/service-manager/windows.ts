import type { ServiceOptions, ServicePlan } from './types.ts'
import { WINDOWS_TASK } from './types.ts'

/** A per-user logon task; installing it never needs administrator rights. */
export function windowsInstallPlan(options: ServiceOptions): ServicePlan {
  return {
    writes: [],
    removals: [],
    actions: [
      {
        command: 'schtasks',
        args: [
          '/Create',
          '/F',
          '/SC',
          'ONLOGON',
          '/TN',
          WINDOWS_TASK,
          '/TR',
          `"${options.execPath}" __supervise`,
        ],
      },
      { command: 'schtasks', args: ['/Run', '/TN', WINDOWS_TASK], allowFailure: true },
    ],
  }
}

export function windowsUninstallPlan(): ServicePlan {
  return {
    writes: [],
    removals: [],
    actions: [{ command: 'schtasks', args: ['/Delete', '/F', '/TN', WINDOWS_TASK] }],
  }
}

export function windowsStatus(): { command: string; args: string[] } {
  return { command: 'schtasks', args: ['/Query', '/TN', WINDOWS_TASK] }
}

export function windowsCommand(options: ServiceOptions): string {
  return `schtasks /Create /F /SC ONLOGON /TN ${WINDOWS_TASK} /TR "\\"${options.execPath}\\" __supervise"`
}
