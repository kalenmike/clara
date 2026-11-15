import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Run the hub service through the packaged command. */
export async function serveHub(): Promise<void> {
  process.env.CLARA_PANEL_ASSETS_DIR ??= sourcePanelDir()
  const { main } = await import('@clara/hub-server/main')
  await main(['serve'])
}

/**
 * A source checkout serves the panel from `apps/hub/panel/dist`. The packaged
 * binary sets `CLARA_PANEL_ASSETS_DIR` after extracting its embedded copy.
 */
function sourcePanelDir(): string | undefined {
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '../../../hub/panel/dist')
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined
}
