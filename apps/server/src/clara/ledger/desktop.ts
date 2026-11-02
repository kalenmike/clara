import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LedgerAlert } from '@clara/shared-types'

const run = promisify(execFile)
const BODY_LIMIT = 220

/**
 * Best-effort local notification for the machine running the home agent. Push
 * covers other devices; this covers the case where no Clara client is open.
 */
export async function sendDesktopAlert(alert: LedgerAlert): Promise<void> {
  const title = clip(alert.title)
  const body = clip(alert.body)

  if (process.platform === 'linux') {
    await run('notify-send', ['--app-name=Clara', '--expire-time=10000', title, body])
    return
  }

  if (process.platform === 'darwin') {
    const script = `display notification ${quote(body)} with title ${quote(title)}`
    await run('osascript', ['-e', script])
    return
  }

  if (process.platform === 'win32') {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$n = New-Object System.Windows.Forms.NotifyIcon; ' +
      '$n.Icon = [System.Drawing.SystemIcons]::Information; ' +
      '$n.Visible = $true; ' +
      `$n.ShowBalloonTip(10000, ${quote(title)}, ${quote(body)}, 'Info'); ` +
      'Start-Sleep -Seconds 1; $n.Dispose()'
    await run('powershell', ['-NoProfile', '-Command', script])
  }
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function clip(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT - 1)}…` : text
}
