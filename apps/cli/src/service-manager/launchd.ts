import type { ServiceOptions, ServicePlan } from './types.ts'
import { environment, launchdPaths, LAUNCHD_LABEL } from './types.ts'

export function launchdPlist(options: ServiceOptions): string {
  const env = Object.entries(environment(options))
    .map(([key, value]) => `    <key>${escape(key)}</key><string>${escape(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(options.execPath)}</string>
    <string>__supervise</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key><string>${escape(options.homeDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escape(`${options.logDir}/supervisor.log`)}</string>
  <key>StandardErrorPath</key><string>${escape(`${options.logDir}/supervisor.log`)}</string>
</dict>
</plist>
`
}

export function launchdInstallPlan(options: ServiceOptions): ServicePlan {
  const { plist } = launchdPaths(options)
  return {
    writes: [{ path: plist, content: launchdPlist(options), mode: 0o644 }],
    removals: [],
    actions: [
      { command: 'launchctl', args: ['unload', plist], allowFailure: true },
      { command: 'launchctl', args: ['load', '-w', plist] },
    ],
  }
}

export function launchdUninstallPlan(options: ServiceOptions): ServicePlan {
  const { plist } = launchdPaths(options)
  return {
    writes: [],
    removals: [plist],
    actions: [{ command: 'launchctl', args: ['unload', plist], allowFailure: true }],
  }
}

export function launchdStatus(): { command: string; args: string[] } {
  return { command: 'launchctl', args: ['list', LAUNCHD_LABEL] }
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
