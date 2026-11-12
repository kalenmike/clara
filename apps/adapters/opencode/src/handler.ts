import { Hono, type Context } from 'hono'
import { booleanQuery, jsonBody, numberQuery } from '@clara/adapter-runtime'
import type {
  FileFindInput,
  MessageListInput,
  PermissionReplyInput,
  ProjectUpdateInput,
  SessionCommandInput,
  SessionCompactInput,
  SessionCreateInput,
  SessionFormCancelInput,
  SessionFormReplyInput,
  SessionForkInput,
  SessionInterruptInput,
  SessionListInput,
  SessionMoveInput,
  SessionPromptInput,
  SessionSwitchAgentInput,
  SessionSwitchModelInput,
  SessionSyntheticInput,
  SessionUpdateInput,
  SessionViewInput,
  VcsDiffInput,
  WorktreeListInput,
} from '@opencode/client'
import { AdapterError } from './errors.ts'
import { loadGitLog } from './git.ts'
import { OpenCodeGateway, toAdapterError } from './opencode.ts'

export type AdapterContext = {
  opencode: OpenCodeGateway
  info: {
    adapter: { name: string; version: string }
    harness: { kind: string; version?: string }
    capabilities: Record<string, unknown>
  }
}

type LocationInput = { location?: { directory?: string } }

const KEEPALIVE_MS = 15_000

export function createAdapterApp(context: AdapterContext): Hono {
  const app = new Hono()
  const client = context.opencode

  app.get('/harness/v1/info', (c) =>
    c.json({
      protocol: 1,
      adapter: context.info.adapter,
      harness: context.info.harness,
      capabilities: context.info.capabilities,
    })
  )

  app.get('/harness/v1/health', async (c) => c.json(await client.probe(1_500)))

  app.get('/harness/v1/harness/info', async (c) =>
    c.json(await run(c, () => client.client.server.info({ signal: c.req.raw.signal })))
  )

  app.get('/harness/v1/projects', async (c) =>
    c.json(
      await run(c, () =>
        client.client.project.list(
          {
            ...(booleanQuery(c, 'archived') !== undefined
              ? { archived: booleanQuery(c, 'archived') }
              : {}),
          },
          { signal: c.req.raw.signal }
        )
      )
    )
  )

  app.patch('/harness/v1/projects/:projectID', async (c) => {
    const body = await jsonBody<Omit<ProjectUpdateInput, 'projectID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.project.update(
          { projectID: c.req.param('projectID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.get('/harness/v1/locations', async (c) =>
    c.json(
      await run(c, () => client.client.location.get(locationInput(c), { signal: c.req.raw.signal }))
    )
  )

  app.get('/harness/v1/files/find', async (c) => {
    const type = fileType(c.req.query('type'))
    const input = {
      ...locationInput(c),
      query: c.req.query('query') ?? '',
      ...(type ? { type } : {}),
      ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
    } satisfies FileFindInput
    return c.json(await run(c, () => client.client.file.find(input, { signal: c.req.raw.signal })))
  })

  app.get('/harness/v1/vcs', async (c) =>
    c.json(
      await run(c, () => client.client.vcs.get(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/vcs/base', async (c) =>
    c.json(
      await run(c, () => client.client.vcs.base(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/vcs/status', async (c) =>
    c.json(
      await run(c, () => client.client.vcs.status(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/vcs/diff', async (c) => {
    const mode = c.req.query('mode')
    if (mode !== 'working' && mode !== 'branch' && mode !== 'committed') {
      throw new AdapterError(400, 'invalid_request', 'A valid VCS diff mode is required')
    }
    const input = {
      ...locationInput(c),
      mode,
      ...(c.req.query('base') ? { base: c.req.query('base') } : {}),
      ...(numberQuery(c, 'context') !== undefined ? { context: numberQuery(c, 'context') } : {}),
    } satisfies VcsDiffInput
    return c.json(await run(c, () => client.client.vcs.diff(input, { signal: c.req.raw.signal })))
  })

  app.get('/harness/v1/worktrees', async (c) =>
    c.json(
      await run(c, () =>
        client.client.worktree.list(worktreeListInput(c.req.query('projectID')), {
          signal: c.req.raw.signal,
        })
      )
    )
  )
  app.post('/harness/v1/worktrees/refresh', async (c) => {
    const body = await jsonBody<{ projectID: string }>(c)
    await run(c, () => client.client.worktree.refresh(body, { signal: c.req.raw.signal }))
    return c.body(null, 204)
  })

  app.get('/harness/v1/sessions', async (c) => {
    const input = sessionListInput(c)
    return c.json(
      await run(c, () => client.client.session.list(input, { signal: c.req.raw.signal }))
    )
  })
  app.post('/harness/v1/sessions', async (c) => {
    const body = await jsonBody<SessionCreateInput>(c)
    return c.json(
      await run(c, () =>
        client.client.session.create(body, {
          signal: c.req.raw.signal,
        })
      )
    )
  })
  app.get('/harness/v1/sessions/active', async (c) =>
    c.json(await run(c, () => client.client.session.active({ signal: c.req.raw.signal })))
  )
  app.get('/harness/v1/sessions/:sessionID', async (c) =>
    c.json(
      await run(c, () =>
        client.client.session.get(
          { sessionID: c.req.param('sessionID') },
          { signal: c.req.raw.signal }
        )
      )
    )
  )
  app.patch('/harness/v1/sessions/:sessionID', async (c) => {
    const body = await jsonBody<Omit<SessionUpdateInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.update(
        { sessionID: c.req.param('sessionID'), ...body },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID', async (c) => {
    await run(c, () =>
      client.client.session.remove(
        { sessionID: c.req.param('sessionID') },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.post('/harness/v1/sessions/:sessionID/fork', async (c) => {
    const body = await jsonBody<Omit<SessionForkInput, 'sessionID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.session.fork(
          { sessionID: c.req.param('sessionID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.post('/harness/v1/sessions/:sessionID/move', async (c) => {
    const body = await jsonBody<Omit<SessionMoveInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.move(
        { sessionID: c.req.param('sessionID'), ...body },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.post('/harness/v1/sessions/:sessionID/view', async (c) => {
    const body = await jsonBody<Omit<SessionViewInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.view(
        { sessionID: c.req.param('sessionID'), idle: body.idle },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.post('/harness/v1/sessions/:sessionID/prompt', async (c) => {
    const body = await jsonBody<Omit<SessionPromptInput, 'sessionID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.session.prompt(
          { sessionID: c.req.param('sessionID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.post('/harness/v1/sessions/:sessionID/synthetic', async (c) => {
    const body = await jsonBody<Omit<SessionSyntheticInput, 'sessionID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.session.synthetic(
          { sessionID: c.req.param('sessionID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.post('/harness/v1/sessions/:sessionID/command', async (c) => {
    const body = await jsonBody<Omit<SessionCommandInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.command(
        { sessionID: c.req.param('sessionID'), ...body },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.post('/harness/v1/sessions/:sessionID/interrupt', async (c) => {
    const body = await jsonBody<Omit<SessionInterruptInput, 'sessionID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.session.interrupt(
          { sessionID: c.req.param('sessionID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.post('/harness/v1/sessions/:sessionID/compact', async (c) => {
    const body = await jsonBody<Omit<SessionCompactInput, 'sessionID'>>(c)
    return c.json(
      await run(c, () =>
        client.client.session.compact(
          { sessionID: c.req.param('sessionID'), ...body },
          { signal: c.req.raw.signal }
        )
      )
    )
  })

  app.post('/harness/v1/sessions/:sessionID/agent', async (c) => {
    const body = await jsonBody<Omit<SessionSwitchAgentInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.switchAgent(
        { sessionID: c.req.param('sessionID'), ...body },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.post('/harness/v1/sessions/:sessionID/model', async (c) => {
    const body = await jsonBody<Omit<SessionSwitchModelInput, 'sessionID'>>(c)
    await run(c, () =>
      client.client.session.switchModel(
        { sessionID: c.req.param('sessionID'), ...body },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.get('/harness/v1/sessions/:sessionID/messages', async (c) => {
    const input = messageListInput(c)
    return c.json(
      await run(c, () => client.client.message.list(input, { signal: c.req.raw.signal }))
    )
  })
  app.get('/harness/v1/sessions/:sessionID/context', async (c) =>
    c.json(
      await run(c, () =>
        client.client.session.context(
          { sessionID: c.req.param('sessionID') },
          { signal: c.req.raw.signal }
        )
      )
    )
  )
  app.get('/harness/v1/sessions/:sessionID/forms', async (c) =>
    c.json(
      await run(c, () =>
        client.client.session.form.list(
          { sessionID: c.req.param('sessionID') },
          { signal: c.req.raw.signal }
        )
      )
    )
  )
  app.post('/harness/v1/sessions/:sessionID/forms/:formID/reply', async (c) => {
    const body = await jsonBody<Omit<SessionFormReplyInput, 'sessionID' | 'formID'>>(c)
    await run(c, () =>
      client.client.session.form.reply(
        {
          sessionID: c.req.param('sessionID'),
          formID: c.req.param('formID'),
          ...body,
        },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID/forms/:formID', async (c) => {
    const body = await jsonBody<Omit<SessionFormCancelInput, 'sessionID' | 'formID'>>(c)
    await run(c, () =>
      client.client.session.form.cancel(
        {
          sessionID: c.req.param('sessionID'),
          formID: c.req.param('formID'),
          ...body,
        },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })
  app.get('/harness/v1/sessions/:sessionID/inbox', async (c) =>
    c.json(
      await run(c, () =>
        client.client.session.inbox.list(
          { sessionID: c.req.param('sessionID') },
          { signal: c.req.raw.signal }
        )
      )
    )
  )
  app.delete('/harness/v1/sessions/:sessionID/inbox/:inboxID', async (c) => {
    await run(c, () =>
      client.client.session.inbox.cancel(
        {
          sessionID: c.req.param('sessionID'),
          inboxID: c.req.param('inboxID'),
        },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.get('/harness/v1/permissions', async (c) =>
    c.json(
      await run(c, () =>
        client.client.permission.request.list(locationInput(c), { signal: c.req.raw.signal })
      )
    )
  )
  app.post('/harness/v1/sessions/:sessionID/permissions/:requestID/reply', async (c) => {
    const body = await jsonBody<Omit<PermissionReplyInput, 'sessionID' | 'requestID'>>(c)
    await run(c, () =>
      client.client.permission.reply(
        {
          sessionID: c.req.param('sessionID'),
          requestID: c.req.param('requestID'),
          ...body,
        },
        { signal: c.req.raw.signal }
      )
    )
    return c.body(null, 204)
  })

  app.get('/harness/v1/agents', async (c) =>
    c.json(
      await run(c, () => client.client.agent.list(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/models', async (c) =>
    c.json(
      await run(c, () => client.client.model.list(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/providers', async (c) =>
    c.json(
      await run(c, () =>
        client.client.provider.list(locationInput(c), { signal: c.req.raw.signal })
      )
    )
  )
  app.get('/harness/v1/commands', async (c) =>
    c.json(
      await run(c, () => client.client.command.list(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/skills', async (c) =>
    c.json(
      await run(c, () => client.client.skill.list(locationInput(c), { signal: c.req.raw.signal }))
    )
  )
  app.get('/harness/v1/references', async (c) =>
    c.json(
      await run(c, () =>
        client.client.reference.list(locationInput(c), { signal: c.req.raw.signal })
      )
    )
  )

  app.get('/harness/v1/git/log', async (c) =>
    c.json(
      await loadGitLog(
        client,
        {
          directory: c.req.query('directory') ?? '',
          since: Number(c.req.query('since')),
          ...(c.req.query('until') ? { until: Number(c.req.query('until')) } : {}),
        },
        c.req.raw.signal
      )
    )
  )

  app.get('/harness/v1/events', (c) => eventStream(client, c.req.raw.signal))

  app.onError((error, c) => {
    if (error instanceof AdapterError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status as 400
      )
    }
    return c.json(
      {
        error: {
          code: 'adapter_error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      500
    )
  })

  return app
}

async function run<T>(_c: Context, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (cause) {
    throw toAdapterError(cause)
  }
}

function eventStream(gateway: OpenCodeGateway, requestSignal: AbortSignal): Response {
  const encoder = new TextEncoder()
  const controller = new AbortController()
  let closed = false
  let lastCommentAt = 0

  const abort = () => controller.abort()
  if (requestSignal.aborted) controller.abort()
  else requestSignal.addEventListener('abort', abort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(target) {
      const send = (text: string) => {
        if (closed) return
        try {
          target.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }
      const comment = () => {
        const now = Date.now()
        if (now - lastCommentAt < KEEPALIVE_MS) return
        lastCommentAt = now
        send(':\n\n')
      }

      lastCommentAt = Date.now()
      send(':\n\n')
      try {
        for await (const event of gateway.client.event.subscribe({
          signal: controller.signal,
          onActivity: comment,
        })) {
          send(`data: ${JSON.stringify(event)}\n\n`)
        }
        if (!closed) target.close()
      } catch (cause) {
        if (!closed) {
          if (controller.signal.aborted) target.close()
          else target.error(toAdapterError(cause))
        }
      } finally {
        closed = true
        requestSignal.removeEventListener('abort', abort)
      }
    },
    cancel() {
      closed = true
      controller.abort()
      requestSignal.removeEventListener('abort', abort)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

function locationInput(c: Context): LocationInput | undefined {
  const directory = c.req.query('directory')
  return directory ? { location: { directory } } : undefined
}

function fileType(value: string | undefined): 'file' | 'directory' | undefined {
  return value === 'file' || value === 'directory' ? value : undefined
}

function sessionListInput(c: Context): SessionListInput {
  const order = c.req.query('order')
  return {
    ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
    ...(order === 'asc' || order === 'desc' ? { order } : {}),
    ...(c.req.query('search') ? { search: c.req.query('search') } : {}),
    ...(c.req.query('parentID') ? { parentID: c.req.query('parentID') } : {}),
    ...(booleanQuery(c, 'archived') !== undefined ? { archived: booleanQuery(c, 'archived') } : {}),
    ...(c.req.query('directory') ? { directory: c.req.query('directory') } : {}),
    ...(c.req.query('project') ? { project: c.req.query('project') } : {}),
    ...(c.req.query('subpath') ? { subpath: c.req.query('subpath') } : {}),
    ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
  }
}

function messageListInput(c: Context): MessageListInput {
  const order = c.req.query('order')
  const type = c.req.query('type') as MessageListInput['type'] | undefined
  return {
    sessionID: c.req.param('sessionID') ?? '',
    ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
    ...(order === 'asc' || order === 'desc' ? { order } : {}),
    ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
    ...(type ? { type } : {}),
  }
}

function worktreeListInput(projectID: string | undefined): WorktreeListInput {
  // The SDK marks this required, but the existing Clara route allows it to be
  // omitted and the old proxy omitted the query in that case.
  return (projectID ? { projectID } : {}) as WorktreeListInput
}
