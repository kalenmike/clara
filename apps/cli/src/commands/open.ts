import { spawn } from 'node:child_process'

/** Open a loopback URL in the platform browser. Failures are silent. */
export function openUrl(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch {
    // A headless host has no browser; the URL was already printed.
  }
}
