import type { ServiceOptions, ServicePlan } from './types.ts'
import { autostartPaths, environment } from './types.ts'

/** Desktop-login fallback for Linux hosts that do not run systemd --user. */
export function autostartEntry(options: ServiceOptions): string {
  const variables = Object.entries(environment(options))
    .map(([key, value]) => `Environment=${JSON.stringify(`${key}=${value}`)}`)
    .join('\n')
  return `[Desktop Entry]
Type=Application
Name=Clara
Comment=Start the Clara hub, engine, and web client
Exec=${quote(options.execPath)} __supervise
${variables}
Terminal=false
X-GNOME-Autostart-enabled=true
`
}

export function autostartInstallPlan(options: ServiceOptions): ServicePlan {
  const { entry } = autostartPaths(options)
  return {
    writes: [{ path: entry, content: autostartEntry(options), mode: 0o644 }],
    removals: [],
    actions: [],
  }
}

export function autostartUninstallPlan(options: ServiceOptions): ServicePlan {
  const { entry } = autostartPaths(options)
  return { writes: [], removals: [entry], actions: [] }
}

export function autostartPath(options: { homeDir: string }): string {
  return autostartPaths(options).entry
}

function quote(value: string): string {
  return /[\s"]/g.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}
