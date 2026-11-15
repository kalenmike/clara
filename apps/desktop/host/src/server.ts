import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import {
  InstallJobService,
  InstallRequestError,
  buildInstallPlan,
  listDockerTargets,
  listSshTargets,
} from '@clara/adapter-install'
import type { AdapterInstallJob } from '@clara/shared-types'
import { parseInstallRequest } from './validate.ts'

const ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

export type HostServerOptions = {
  token: string
  port?: number
  jobs?: InstallJobService
  log?: (message: string, detail?: unknown) => void
}

export type HostServer = {
  baseUrl: string
  close: () => Promise<void>
}

/**
 * The loopback service the desktop webview calls for adapter installs. It is
 * only reachable with the per-launch token the Tauri shell passes to both
 * sides, and it never runs arbitrary commands: the kind, target, and manifest
 * are validated, and the manifest's installer hash is checked on the target.
 */
export async function startHostServer(options: HostServerOptions): Promise<HostServer> {
  const jobs = options.jobs ?? new InstallJobService()
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: (origin) => (ORIGINS.has(origin) ? origin : ''),
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    })
  )

  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next()
    const authorization = c.req.header('authorization')
    if (authorization !== `Bearer ${options.token}`) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/targets', async (c) => {
    const [ssh, docker] = await Promise.all([listSshTargets(), listDockerTargets()])
    return c.json({ ssh, docker })
  })

  app.post('/install', async (c) => {
    const request = parseInstallRequest(await c.req.json())
    const plan = buildInstallPlan({
      kind: request.kind,
      method: request.method,
      manifest: request.manifest,
      pairingCode: request.pairingCode,
      ...(request.host ? { host: request.host } : {}),
      ...(request.container ? { container: request.container } : {}),
      ...(request.opencodeUrl ? { opencodeUrl: request.opencodeUrl } : {}),
    })
    const job = jobs.start({
      kind: request.kind,
      method: request.method,
      target: plan.target,
      command: plan.command,
      args: plan.args,
    })
    return c.json(job)
  })

  app.get('/install/:id', (c) => {
    const job = jobs.job(c.req.param('id'))
    if (!job) return c.json({ error: 'not_found' }, 404)
    return c.json(job)
  })

  app.delete('/install/:id', (c) => {
    if (!jobs.cancel(c.req.param('id'))) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  })

  app.onError((cause, c) => {
    if (cause instanceof InstallRequestError) {
      return c.json({ error: cause.message, code: cause.code }, cause.status as 400)
    }
    options.log?.('adapter host request failed', cause)
    return c.json({ error: 'The adapter host could not complete the request.' }, 500)
  })

  const server = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const started = serve(
      {
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: options.port ?? 0,
      },
      (info) => {
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((done, fail) => {
              started.close((cause) => (cause ? fail(cause) : done()))
            }),
        })
      }
    )
  })

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    close: async () => {
      jobs.close()
      await server.close()
    },
  }
}

export type { AdapterInstallJob }
