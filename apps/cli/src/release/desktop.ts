import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { downloadVerified, type Progress } from './download.ts'
import { type DesktopArtifact, type ReleaseManifest } from './manifest.ts'
import { platformKey, type PlatformInput } from './platform.ts'

const APP_ID = 'com.kalenmichael.clara'
const APP_NAME = 'Clara'
const DESKTOP_BINARY = 'clara-desktop'
const DESKTOP_FILE = 'clara.desktop'

export type DesktopInstallInfo = {
  schemaVersion: 1
  version: string
  platform: string
  installedAt: string
  path: string
  type: DesktopArtifact['type']
}

export type DesktopStatus = {
  installed: boolean
  version?: string
  platform?: string
  path?: string
}

export type DesktopCommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export type DesktopRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => DesktopCommandResult

export type DesktopInstallOptions = {
  manifest: ReleaseManifest
  cacheDir: string
  dataDir: string
  configDir: string
  binDir: string
  appsDir?: string
  homeDir?: string
  platform?: string
  fetchImpl?: typeof fetch
  onProgress?: Progress
  run?: DesktopRunner
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
}

export class DesktopUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopUnavailableError'
  }
}

/** The desktop platform key, excluding Linux musl where no desktop build exists. */
export function desktopPlatformKey(input: PlatformInput = {}): string | undefined {
  const key = platformKey(input)
  if (!key || key.endsWith('-musl')) return undefined
  return key
}

export function desktopArtifact(manifest: ReleaseManifest, platform?: string): DesktopArtifact {
  const key = platform ?? desktopPlatformKey()
  if (!key) throw new DesktopUnavailableError('This machine has no desktop build.')
  const artifact = manifest.desktop?.artifacts[key]
  if (!artifact) {
    throw new DesktopUnavailableError(`The release has no desktop build for ${key}.`)
  }
  return artifact
}

export function desktopInstallInfoPath(configDir: string): string {
  return join(configDir, 'desktop.json')
}

export function readDesktopInstallInfo(configDir: string): DesktopInstallInfo | undefined {
  try {
    const path = desktopInstallInfoPath(configDir)
    if (!existsSync(path)) return undefined
    const value = JSON.parse(readFileSync(path, 'utf8')) as DesktopInstallInfo
    return value?.schemaVersion === 1 && typeof value.version === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export function desktopStatus(configDir: string): DesktopStatus {
  const info = readDesktopInstallInfo(configDir)
  if (!info || !existsSync(info.path)) return { installed: false }
  return {
    installed: true,
    version: info.version,
    platform: info.platform,
    path: info.path,
  }
}

/** Download and install the desktop artifact named by the release manifest. */
export async function installDesktop(options: DesktopInstallOptions): Promise<DesktopInstallInfo> {
  const platform = options.platform ?? desktopPlatformKey()
  if (!platform) throw new DesktopUnavailableError('This machine has no desktop build.')
  const artifact = desktopArtifact(options.manifest, platform)
  const version = options.manifest.desktop?.version ?? options.manifest.version
  const extension = artifact.type === 'appimage' ? 'AppImage' : artifact.type
  const archive = join(
    options.cacheDir,
    'downloads',
    `clara-desktop-${version}-${platform}.${extension}`
  )

  await downloadVerified({
    url: artifact.url,
    sha256: artifact.sha256,
    dest: archive,
    total: artifact.size,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  })

  try {
    const path = installArchive(options, archive, artifact, platform, version)
    const info: DesktopInstallInfo = {
      schemaVersion: 1,
      version,
      platform,
      installedAt: new Date().toISOString(),
      path,
      type: artifact.type,
    }
    writeDesktopInfo(options.configDir, info)
    return info
  } finally {
    rmSync(archive, { force: true })
  }
}

function installArchive(
  options: DesktopInstallOptions,
  archive: string,
  artifact: DesktopArtifact,
  platform: string,
  version: string
): string {
  const run = options.run ?? defaultDesktopRunner
  switch (artifact.type) {
    case 'dmg':
      return installDmg(options, archive, run)
    case 'appimage':
      return installAppImage(options, archive, platform, version, run)
    case 'nsis':
      return installNsis(options, archive, run)
    case 'msi':
      return installMsi(options, archive, run)
  }
}

function installDmg(options: DesktopInstallOptions, archive: string, run: DesktopRunner): string {
  const appsDir = options.appsDir ?? join(options.homeDir ?? homedir(), 'Applications')
  mkdirSync(appsDir, { recursive: true, mode: 0o755 })
  const mount = mkdtempSync(join(tmpdir(), 'clara-desktop-dmg-'))
  try {
    requireOk(run('hdiutil', ['attach', archive, '-nobrowse', '-readonly', '-mountpoint', mount]), [
      'hdiutil',
      'attach',
    ])
    const app = readdirSync(mount, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.endsWith('.app')
    )
    if (!app) throw new Error('The desktop disk image did not contain a Clara app.')
    const target = join(appsDir, app.name)
    rmSync(target, { recursive: true, force: true })
    requireOk(run('ditto', [join(mount, app.name), target]), ['ditto'])
    return target
  } finally {
    run('hdiutil', ['detach', mount, '-force'])
    rmSync(mount, { recursive: true, force: true })
  }
}

function installAppImage(
  options: DesktopInstallOptions,
  archive: string,
  platform: string,
  version: string,
  run: DesktopRunner
): string {
  const root = join(options.dataDir, 'desktop', 'versions', version)
  mkdirSync(root, { recursive: true, mode: 0o755 })
  const target = join(root, 'Clara.AppImage')
  copyFileSync(archive, target)
  chmodSync(target, 0o755)

  const link = join(options.binDir, DESKTOP_BINARY)
  mkdirSync(options.binDir, { recursive: true, mode: 0o755 })
  const temporary = `${link}.${process.pid}.tmp`
  rmSync(temporary, { force: true })
  symlinkSync(target, temporary)
  renameSync(temporary, link)

  const dataHome = options.homeDir
    ? join(options.homeDir, '.local', 'share')
    : options.env?.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  const applications = join(dataHome, 'applications')
  mkdirSync(applications, { recursive: true, mode: 0o755 })
  writeAtomic(join(applications, DESKTOP_FILE), desktopEntry(link), 0o644)

  installAppImageIcon(target, options, run)

  run('update-desktop-database', [applications])
  run('gtk-update-icon-cache', ['-f', '-t', join(dataHome, 'icons', 'hicolor')])
  run('xdg-mime', ['default', DESKTOP_FILE, 'x-scheme-handler/clara'], {
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  })
  options.log?.(`Installed the ${APP_NAME} desktop app for ${platform}.`)
  return link
}

function installAppImageIcon(
  appImage: string,
  options: DesktopInstallOptions,
  run: DesktopRunner
): void {
  const extract = mkdtempSync(join(tmpdir(), 'clara-desktop-icon-'))
  try {
    const result = run(appImage, ['--appimage-extract'], { cwd: extract })
    if (result.status !== 0) return
    const root = join(extract, 'squashfs-root')
    const icon = findIcon(root)
    if (!icon) return
    const dataHome = options.homeDir
      ? join(options.homeDir, '.local', 'share')
      : options.env?.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
    const directory = join(dataHome, 'icons', 'hicolor', '256x256', 'apps')
    mkdirSync(directory, { recursive: true, mode: 0o755 })
    copyFileSync(icon, join(directory, `${DESKTOP_BINARY}.png`))
  } finally {
    rmSync(extract, { recursive: true, force: true })
  }
}

function findIcon(directory: string): string | undefined {
  if (!existsSync(directory)) return undefined
  const candidates: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.png$/i.test(entry.name)) candidates.push(path)
    }
  }
  visit(directory)
  return candidates.sort((left, right) => right.length - left.length)[0]
}

function installNsis(options: DesktopInstallOptions, archive: string, run: DesktopRunner): string {
  requireOk(run(archive, ['/S']), ['desktop installer'])
  const local = options.env?.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
  const candidates = [
    join(local, 'Programs', APP_NAME, 'Clara.exe'),
    join(local, 'Programs', APP_NAME, 'clara-desktop.exe'),
    join(local, APP_NAME, 'Clara.exe'),
    join(local, APP_NAME, 'clara-desktop.exe'),
    join(local, 'clara-desktop', 'clara-desktop.exe'),
  ]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (!path) {
    throw new Error(`The desktop installer finished but ${APP_NAME}.exe was not found.`)
  }
  options.log?.(`Installed the ${APP_NAME} desktop app.`)
  return path
}

function installMsi(options: DesktopInstallOptions, archive: string, run: DesktopRunner): string {
  requireOk(run('msiexec.exe', ['/i', archive, '/qn', '/norestart']), ['msiexec'])
  const programFiles = options.env?.PROGRAMFILES?.trim() || 'C:\\Program Files'
  const path = [join(programFiles, APP_NAME, 'Clara.exe'), join(programFiles, APP_NAME, 'clara-desktop.exe')].find(
    (candidate) => existsSync(candidate)
  )
  if (!path) {
    throw new Error(`The MSI finished but ${APP_NAME}.exe was not found.`)
  }
  options.log?.(`Installed the ${APP_NAME} desktop app.`)
  return path
}

/** Remove the installed desktop app and its integration. */
export function uninstallDesktop(options: {
  configDir: string
  binDir: string
  dataDir: string
  homeDir?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  purge?: boolean
  run?: DesktopRunner
  log?: (line: string) => void
}): boolean {
  const info = readDesktopInstallInfo(options.configDir)
  const run = options.run ?? defaultDesktopRunner
  const home = options.homeDir ?? homedir()
  const dataHome = options.homeDir
    ? join(options.homeDir, '.local', 'share')
    : options.env?.XDG_DATA_HOME?.trim() || join(home, '.local', 'share')

  if (info?.type === 'dmg') {
    rmSync(info.path, { recursive: true, force: true })
  } else if (info?.type === 'appimage') {
    rmSync(info.path, { force: true })
    rmSync(join(options.dataDir, 'desktop', 'versions', info.version), {
      recursive: true,
      force: true,
    })
    rmSync(join(options.binDir, DESKTOP_BINARY), { force: true })
    rmSync(join(dataHome, 'applications', DESKTOP_FILE), { force: true })
    for (const size of ['32x32', '128x128', '256x256@2', '256x256']) {
      rmSync(join(dataHome, 'icons', 'hicolor', size, 'apps', `${DESKTOP_BINARY}.png`), {
        force: true,
      })
    }
  } else if (info?.type === 'nsis' || info?.type === 'msi') {
    const uninstaller = join(dirname(info.path), 'uninstall.exe')
    if (existsSync(uninstaller)) run(uninstaller, ['/S'])
    else rmSync(info.path, { force: true })
  }

  rmSync(desktopInstallInfoPath(options.configDir), { force: true })
  if (options.purge) {
    for (const directory of desktopDataDirs({
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.homeDir ? { homeDir: options.homeDir } : {}),
      ...(options.env ? { env: options.env } : {}),
    })) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  options.log?.(info ? `Removed ${APP_NAME} ${info.version}.` : 'The desktop app is not installed.')
  return Boolean(info)
}

function desktopEntry(binary: string): string {
  const exec = binary.includes(' ') ? `"${binary}"` : binary
  return [
    '[Desktop Entry]',
    'Categories=Development;',
    `Comment=${APP_NAME} desktop client`,
    `Exec=${exec}`,
    `StartupWMClass=${DESKTOP_BINARY}`,
    `Icon=${DESKTOP_BINARY}`,
    `Name=${APP_NAME}`,
    'Terminal=false',
    'Type=Application',
    'MimeType=x-scheme-handler/clara',
    '',
  ].join('\n')
}

function writeDesktopInfo(configDir: string, info: DesktopInstallInfo): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  writeAtomic(desktopInstallInfoPath(configDir), `${JSON.stringify(info, null, 2)}\n`, 0o600)
}

function writeAtomic(path: string, content: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content, { mode })
  renameSync(temporary, path)
}

function requireOk(result: DesktopCommandResult, label: string[]): void {
  if (result.error) throw new Error(`${label[0]} could not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${label.join(' ')} exited ${result.status ?? 'without a status'}.`)
  }
}

export function defaultDesktopRunner(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): DesktopCommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

/** The directories the desktop webview uses for pairing data and caches. */
export function desktopDataDirs(input: {
  platform?: NodeJS.Platform
  homeDir?: string
  env?: NodeJS.ProcessEnv
}): string[] {
  const platform = input.platform ?? process.platform
  const home = input.homeDir ?? homedir()
  const env = input.env ?? process.env
  if (platform === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', APP_ID),
      join(home, 'Library', 'Caches', APP_ID),
    ]
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || join(home, 'AppData', 'Roaming')
    const local = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local')
    return [join(appData, APP_ID), join(local, APP_ID, 'cache')]
  }
  const dataHome = env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share')
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(home, '.cache')
  return [join(dataHome, APP_ID), join(cacheHome, APP_ID)]
}
