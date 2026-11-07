import { watch, watchFile, unwatchFile, type FSWatcher } from 'node:fs'

/**
 * Polls the known source files and watches the package directories so adding a
 * new task or pipeline also refreshes the preview. The source set is small
 * (one config, package indexes, pipelines, routers, and tasks).
 */
export class SourceWatcher {
  private paths: string[] = []
  private watchers: FSWatcher[] = []
  private timer: NodeJS.Timeout | undefined
  private onChange: (() => void) | undefined

  watch(paths: string[], directories: string[], onChange: () => void): void {
    this.stop()
    this.paths = [...new Set(paths)]
    this.onChange = onChange
    for (const path of this.paths) {
      watchFile(path, { interval: 750, persistent: false }, () => this.fire())
    }
    for (const directory of [...new Set(directories)]) {
      try {
        const watcher = watch(directory, { persistent: false }, () => this.fire())
        watcher.on('error', () => {})
        this.watchers.push(watcher)
      } catch {
        // A missing directory is not fatal; the next preview will retry.
      }
    }
  }

  private fire(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.onChange?.()
    }, 250)
  }

  stop(): void {
    for (const path of this.paths) unwatchFile(path)
    for (const watcher of this.watchers) watcher.close()
    this.paths = []
    this.watchers = []
    this.onChange = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
