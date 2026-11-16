import { resolvePaths } from '../paths.ts'
import {
  DesktopUnavailableError,
  desktopStatus,
  installDesktop,
  readDesktopInstallInfo,
  uninstallDesktop,
} from '../release/desktop.ts'
import { fetchManifest, GITHUB_RELEASE_BASE_URL } from '../release/manifest.ts'
import { defaultBinDir } from '../release/version-store.ts'
import { dim } from '../ui/color.ts'
import { failure, success, warn } from '../ui/index.ts'
import { startSpinner } from '../ui/spinner.ts'
import { parseFlags } from './flags.ts'

export async function runDesktopCommand(args: readonly string[]): Promise<number> {
  const parsed = parseFlags(args)
  const action = parsed.positionals[0] ?? 'status'
  const paths = resolvePaths()

  if (action === 'install') {
    const binDir = parsed.options.get('bin-dir') ?? defaultBinDir()
    const optional = parsed.flags.has('optional')
    const spinner = startSpinner('Reading the Clara release')
    try {
      const fetched = await fetchManifest({
        ...(parsed.options.has('base-url') ? { baseUrl: parsed.options.get('base-url') } : {}),
        fallbackBaseUrl: GITHUB_RELEASE_BASE_URL,
      })
      if (!fetched.manifest.desktop) {
        throw new DesktopUnavailableError('This release has no Clara desktop app.')
      }
      const version = fetched.manifest.desktop.version
      spinner.update(`Downloading Clara Desktop ${version}`)
      const result = await installDesktop({
        manifest: fetched.manifest,
        cacheDir: paths.cacheDir,
        dataDir: paths.dataDir,
        configDir: paths.configDir,
        binDir,
        onProgress: (received, total) => {
          if (total > 0) {
            const percent = Math.round((received / total) * 100)
            spinner.update(`Downloading Clara Desktop ${version} (${percent}%)`)
          }
        },
        log: (line) => spinner.update(line),
      })
      spinner.succeed(`Installed Clara Desktop ${result.version}.`)
      console.log(dim(`  ${result.path}`))
      return 0
    } catch (cause) {
      if (cause instanceof DesktopUnavailableError) {
        spinner.stop()
        if (optional) {
          console.log(dim(cause.message))
          return 0
        }
        console.error(failure(cause.message))
        return 1
      }
      spinner.fail(cause instanceof Error ? cause.message : String(cause))
      return 1
    }
  }

  if (action === 'status') {
    const status = desktopStatus(paths.configDir)
    if (parsed.flags.has('json')) {
      console.log(JSON.stringify(status, null, 2))
      return 0
    }
    if (!status.installed) {
      console.log(dim('Clara Desktop is not installed.'))
      return 0
    }
    console.log(`Clara Desktop ${status.version} (${status.platform})`)
    console.log(dim(`  ${status.path}`))
    return 0
  }

  if (action === 'uninstall') {
    const info = readDesktopInstallInfo(paths.configDir)
    if (!info) {
      console.log(dim('Clara Desktop is not installed.'))
      return 0
    }
    const removed = uninstallDesktop({
      configDir: paths.configDir,
      dataDir: paths.dataDir,
      binDir: defaultBinDir(),
      purge: parsed.flags.has('purge'),
    })
    console.log(
      removed ? success(`Removed Clara Desktop ${info.version}.`) : warn('Nothing was removed.')
    )
    return 0
  }

  console.error(failure(`unknown desktop action: ${action}`))
  console.log(dim('Use install, status, or uninstall.'))
  return 2
}
