import type { ServiceOptions, ServicePlan } from './types.ts'
import { environment, systemdPaths } from './types.ts'

export function systemdUnit(options: ServiceOptions): string {
  const env = Object.entries(environment(options))
    .map(([key, value]) => `Environment=${JSON.stringify(`${key}=${value}`)}`)
    .join('\n')
  return `[Unit]
Description=Clara hub, engine, and web client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${options.homeDir}
${env}
ExecStart=${quote(options.execPath)} __supervise
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`
}

export function systemdInstallPlan(options: ServiceOptions): ServicePlan {
  const { unit } = systemdPaths(options)
  return {
    writes: [{ path: unit, content: systemdUnit(options), mode: 0o644 }],
    removals: [],
    actions: [
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      { command: 'systemctl', args: ['--user', 'enable', '--now', 'clara.service'] },
    ],
  }
}

export function systemdUninstallPlan(options: ServiceOptions): ServicePlan {
  const { unit } = systemdPaths(options)
  return {
    writes: [],
    removals: [unit],
    actions: [
      { command: 'systemctl', args: ['--user', 'disable', '--now', 'clara.service'] },
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
    ],
  }
}

export function systemdStatus(): { command: string; args: string[] } {
  return { command: 'systemctl', args: ['--user', 'is-active', 'clara.service'] }
}

function quote(value: string): string {
  return /[\s"]/g.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}
