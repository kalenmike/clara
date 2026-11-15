import {
  engineURL,
  labPort,
  LabRuntime,
  readToken,
  startLabServer,
  workspace,
} from '@clara/lab-server'
import { installShutdownHandlers } from '@clara/service-control'
import { version } from '../version.ts'

/**
 * Run the Clara Lab service through the packaged command. The supervisor starts
 * the engine first, so the runtime connects to it and stays usable offline
 * instead of spawning an engine of its own. The lab serves the API only: Clara
 * Desktop renders the lab UI at `/lab` and reaches this service over the hub.
 */
export async function serveLab(): Promise<void> {
  const port = labPort()
  const engine = engineURL()
  const runtime = new LabRuntime({ url: engine, token: readToken(), workspace: workspace() })
  await runtime.start()

  const server = await startLabServer({
    runtime,
    port,
    version: version(),
    ...(process.env.CLARA_LAB_HOST?.trim() ? { host: process.env.CLARA_LAB_HOST.trim() } : {}),
    ...(process.env.CLARA_LAB_TOKEN?.trim() ? { token: process.env.CLARA_LAB_TOKEN.trim() } : {}),
    ...(allowRemote() ? { allowRemote: true } : {}),
    log: (message, detail) => console.error(`[clara-lab] ${message}`, detail ?? ''),
  })

  console.log(`[clara-lab] listening on ${server.url}`)
  console.log(`[clara-lab] workspace ${runtime.state.workspace}`)
  console.log(`[clara-lab] engine ${engine} (${runtime.state.connected ? 'connected' : 'offline'})`)

  const shutdown = async (): Promise<void> => {
    // Abort the engine stream and the lab's own streams together: the engine
    // cannot close while a lab relay is still reading its event feed.
    await Promise.allSettled([server.close(), runtime.stop()])
  }
  installShutdownHandlers({ label: 'clara-lab', close: shutdown })
}

function allowRemote(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    process.env.CLARA_LAB_ALLOW_REMOTE?.trim().toLowerCase() ?? ''
  )
}
