import { spawn } from 'node:child_process'

/** Open the agent panel in the platform browser without blocking the CLI. */
export function openPanel(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    const opener = spawn(command, args, { stdio: 'ignore', detached: true })
    opener.on('error', () => console.warn(`Could not open a browser. Visit ${url}`))
    opener.unref()
    return true
  } catch {
    console.warn(`Could not open a browser. Visit ${url}`)
    return false
  }
}
