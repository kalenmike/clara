import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

export class PickerUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PickerUnavailable'
  }
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  missing: boolean
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let missing = false
    let settled = false
    const done = (code: number | null): void => {
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr, missing })
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      missing = error.code === 'ENOENT'
      if (!missing) stderr = error.message
      done(null)
    })
    child.on('close', (code) => done(code))
  })
}

function selected(result: CommandResult): string | undefined {
  const value = result.stdout.trim().split(/\r?\n/)[0]?.trim()
  if (!value) return undefined
  if (value === '/' || value === '\\' || /^[A-Za-z]:[\\/]$/.test(value)) return value
  return value.replace(/[\\/]+$/, '')
}

async function linux(initial: string | undefined): Promise<string | undefined> {
  const directory = initial || homedir()
  const candidates = [
    {
      command: 'zenity',
      args: [
        '--file-selection',
        '--directory',
        '--title=Choose a Clara workspace',
        `--filename=${directory}/`,
      ],
    },
    {
      command: 'kdialog',
      args: ['--getexistingdirectory', directory, '--title', 'Choose a Clara workspace'],
    },
    {
      command: 'yad',
      args: [
        '--file',
        '--directory',
        '--title=Choose a Clara workspace',
        `--filename=${directory}/`,
      ],
    },
  ]

  for (const candidate of candidates) {
    const result = await run(candidate.command, candidate.args)
    if (result.missing) continue
    if (result.code !== 0) {
      if (result.stderr.trim()) throw new PickerUnavailable(result.stderr.trim())
      return undefined
    }
    return selected(result)
  }

  throw new PickerUnavailable(
    'No native directory picker is available. Install zenity or kdialog, or type the path.'
  )
}

async function mac(initial: string | undefined): Promise<string | undefined> {
  const location = initial ? ` default location POSIX file ${JSON.stringify(initial)}` : ''
  const script = `POSIX path of (choose folder with prompt "Choose a Clara workspace"${location})`
  const result = await run('osascript', ['-e', script])
  if (result.missing) throw new PickerUnavailable('osascript is not available on this machine.')
  if (result.code !== 0) return undefined
  return selected(result)
}

function quoteSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function windows(initial: string | undefined): Promise<string | undefined> {
  const seed = initial ? `$dialog.SelectedPath = ${quoteSingle(initial)}; ` : ''
  const script =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
    "$dialog.Description = 'Choose a Clara workspace'; " +
    seed +
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }'
  const result = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
  if (result.missing) throw new PickerUnavailable('PowerShell is not available on this machine.')
  if (result.code !== 0) return undefined
  return selected(result)
}

/** Open the host's native directory chooser. Returns undefined when cancelled. */
export async function pickDirectory(initial?: string): Promise<string | undefined> {
  const seed = initial?.trim() || undefined
  if (process.platform === 'darwin') return mac(seed)
  if (process.platform === 'win32') return windows(seed)
  return linux(seed)
}
