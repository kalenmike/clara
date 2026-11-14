import type {
  ApiInfo,
  ClaraAgentListOutput,
  ClaraCommandListOutput,
  ClaraFileFindOutput,
  ClaraForm,
  ClaraHarnessConnection,
  ClaraLocation,
  ClaraModelListOutput,
  ClaraPermissionRequestListOutput,
  ClaraProject,
  ClaraProjectArchiveResult,
  ClaraProjectAvailable,
  ClaraProjectDeleteResult,
  ClaraProviderListOutput,
  ClaraReferenceListOutput,
  ClaraActivitySessionsResponse,
  ClaraServerInfo,
  ClaraSession,
  ClaraSessionActiveOutput,
  ClaraSessionInboxCompaction,
  ClaraSessionInboxInfo,
  ClaraSessionInboxSynthetic,
  ClaraSessionInboxUser,
  ClaraSessionInterruptResponse,
  ClaraSessionMessage,
  ClaraSessionMessagesResponse,
  ClaraSessionsResponse,
  ClaraSkillListOutput,
  ClaraVcsBaseOutput,
  ClaraVcsDiffOutput,
  ClaraVcsGetOutput,
  ClaraVcsStatusOutput,
  ClaraWorktree,
  GitCommit,
} from '@clara/api-contract'
import { ClaraApiError } from './errors.ts'
import { queryString } from './query.ts'
import { subscribeEvents } from './sse.ts'
import type { ClaraClient, ClaraClientOptions, RequestOptions } from './types.ts'

export function createClaraClient(options: ClaraClientOptions): ClaraClient {
  const baseUrl = options.baseUrl ?? 'http://clara.api'
  const fetch = options.fetch

  async function request<T>(
    method: string,
    path: string,
    init: {
      query?: Record<string, unknown>
      body?: unknown
      options?: RequestOptions
    } = {}
  ): Promise<T> {
    const url = new URL(`${path}${queryString(init.query ?? {})}`, baseUrl)
    const headers = new Headers(init.options?.headers)
    let body: string | undefined
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.body)
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: init.options?.signal,
    })
    if (!response.ok) throw await ClaraApiError.from(response)
    if (response.status === 204 || response.status === 205) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  return {
    server: {
      info: (requestOptions) =>
        request<ClaraServerInfo>('GET', '/v1/harness/info', { options: requestOptions }),
      status: (requestOptions) => request<ApiInfo>('GET', '/v1/info', { options: requestOptions }),
      openapi: (requestOptions) =>
        request<Record<string, unknown>>('GET', '/openapi.json', { options: requestOptions }),
    },
    activity: {
      sessions: (input, requestOptions) =>
        request<ClaraActivitySessionsResponse>('GET', '/v1/activity/sessions', {
          query: { project: input?.project, refresh: input?.refresh },
          options: requestOptions,
        }),
    },
    harness: {
      list: (requestOptions) =>
        request<ClaraHarnessConnection[]>('GET', '/v1/harnesses', {
          options: requestOptions,
        }),
    },
    project: {
      list: (input, requestOptions) =>
        request<ClaraProject[]>('GET', '/v1/projects', {
          query: { archived: input?.archived },
          options: requestOptions,
        }),
      create: (input, requestOptions) =>
        request<ClaraProject>('POST', '/v1/projects', {
          body: input,
          options: requestOptions,
        }),
      update: (input, requestOptions) => {
        const { projectID, ...body } = input
        return request<ClaraProject>('PATCH', `/v1/projects/${encodeURIComponent(projectID)}`, {
          body,
          options: requestOptions,
        })
      },
      archive: (input, requestOptions) =>
        request<ClaraProjectArchiveResult>(
          'POST',
          `/v1/projects/${encodeURIComponent(input.projectID)}/archive`,
          { options: requestOptions }
        ),
      unarchive: (input, requestOptions) =>
        request<ClaraProjectArchiveResult>(
          'POST',
          `/v1/projects/${encodeURIComponent(input.projectID)}/unarchive`,
          { options: requestOptions }
        ),
      remove: (input, requestOptions) =>
        request<ClaraProjectDeleteResult>(
          'DELETE',
          `/v1/projects/${encodeURIComponent(input.projectID)}`,
          {
            query: { mode: input.mode },
            options: requestOptions,
          }
        ),
      sync: (input, requestOptions) =>
        request<ClaraProject>('POST', `/v1/projects/${encodeURIComponent(input.projectID)}/sync`, {
          options: requestOptions,
        }),
      available: (input, requestOptions) =>
        request<ClaraProjectAvailable[]>('GET', '/v1/projects/available', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
      workspace: {
        add: (input, requestOptions) => {
          const { projectID, ...body } = input
          return request<ClaraProject>(
            'POST',
            `/v1/projects/${encodeURIComponent(projectID)}/workspaces`,
            { body, options: requestOptions }
          )
        },
        remove: (input, requestOptions) =>
          request<void>(
            'DELETE',
            `/v1/projects/${encodeURIComponent(input.projectID)}/workspaces/${encodeURIComponent(input.workspaceID)}`,
            { options: requestOptions }
          ),
      },
    },
    location: {
      get: (input, requestOptions) =>
        request<ClaraLocation>('GET', '/v1/locations', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    session: {
      list: (input, requestOptions) =>
        request<ClaraSessionsResponse>('GET', '/v1/sessions', {
          query: {
            limit: input?.limit,
            order: input?.order,
            search: input?.search,
            parentID: input?.parentID,
            archived: input?.archived,
            directory: input?.directory,
            project: input?.project,
            harnessID: input?.harnessID,
            subpath: input?.subpath,
            cursor: input?.cursor,
          },
          options: requestOptions,
        }),
      get: (input, requestOptions) =>
        request<ClaraSession>('GET', `/v1/sessions/${encodeURIComponent(input.sessionID)}`, {
          options: requestOptions,
        }),
      create: (input, requestOptions) =>
        request<ClaraSession>('POST', '/v1/sessions', {
          body: input ?? {},
          options: requestOptions,
        }),
      update: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<void>('PATCH', `/v1/sessions/${encodeURIComponent(sessionID)}`, {
          body,
          options: requestOptions,
        })
      },
      remove: (input, requestOptions) =>
        request<void>('DELETE', `/v1/sessions/${encodeURIComponent(input.sessionID)}`, {
          options: requestOptions,
        }),
      fork: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<ClaraSession>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/fork`, {
          body,
          options: requestOptions,
        })
      },
      move: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<void>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/move`, {
          body,
          options: requestOptions,
        })
      },
      view: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<void>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/view`, {
          body,
          options: requestOptions,
        })
      },
      prompt: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<ClaraSessionInboxUser>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/prompt`,
          { body, options: requestOptions }
        )
      },
      synthetic: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<ClaraSessionInboxSynthetic>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/synthetic`,
          { body, options: requestOptions }
        )
      },
      command: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<void>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/command`, {
          body,
          options: requestOptions,
        })
      },
      interrupt: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<ClaraSessionInterruptResponse>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/interrupt`,
          { body, options: requestOptions }
        )
      },
      compact: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<ClaraSessionInboxCompaction>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/compact`,
          { body, options: requestOptions }
        )
      },
      switchAgent: (input, requestOptions) => {
        const { sessionID, agent } = input
        return request<void>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/agent`, {
          body: { agent },
          options: requestOptions,
        })
      },
      switchModel: (input, requestOptions) => {
        const { sessionID, model } = input
        return request<void>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/model`, {
          body: { model },
          options: requestOptions,
        })
      },
      context: (input, requestOptions) =>
        request<ClaraSessionMessage[]>(
          'GET',
          `/v1/sessions/${encodeURIComponent(input.sessionID)}/context`,
          { options: requestOptions }
        ),
      active: (input, requestOptions) =>
        request<ClaraSessionActiveOutput>('GET', '/v1/sessions/active', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
      form: {
        list: (input, requestOptions) =>
          request<ClaraForm[]>('GET', `/v1/sessions/${encodeURIComponent(input.sessionID)}/forms`, {
            options: requestOptions,
          }),
        reply: (input, requestOptions) => {
          const { sessionID, formID, answer } = input
          return request<void>(
            'POST',
            `/v1/sessions/${encodeURIComponent(sessionID)}/forms/${encodeURIComponent(formID)}/reply`,
            { body: { answer }, options: requestOptions }
          )
        },
        cancel: (input, requestOptions) => {
          const { sessionID, formID, message } = input
          return request<void>(
            'DELETE',
            `/v1/sessions/${encodeURIComponent(sessionID)}/forms/${encodeURIComponent(formID)}`,
            { body: { message }, options: requestOptions }
          )
        },
      },
      inbox: {
        list: (input, requestOptions) =>
          request<ClaraSessionInboxInfo[]>(
            'GET',
            `/v1/sessions/${encodeURIComponent(input.sessionID)}/inbox`,
            { options: requestOptions }
          ),
        cancel: (input, requestOptions) =>
          request<void>(
            'DELETE',
            `/v1/sessions/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
            { options: requestOptions }
          ),
      },
    },
    message: {
      list: (input, requestOptions) => {
        const { sessionID, ...query } = input
        return request<ClaraSessionMessagesResponse>(
          'GET',
          `/v1/sessions/${encodeURIComponent(sessionID)}/messages`,
          {
            query: {
              order: query.order,
              limit: query.limit,
              cursor: query.cursor,
              type: query.type,
            },
            options: requestOptions,
          }
        )
      },
    },
    permission: {
      request: {
        list: (input, requestOptions) =>
          request<ClaraPermissionRequestListOutput>('GET', '/v1/permissions', {
            query: { directory: input?.location?.directory, harnessID: input?.harnessID },
            options: requestOptions,
          }),
      },
      reply: (input, requestOptions) => {
        const { sessionID, requestID, decision, message } = input
        return request<void>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(requestID)}/reply`,
          { body: { decision, message }, options: requestOptions }
        )
      },
    },
    agent: {
      list: (input, requestOptions) =>
        request<ClaraAgentListOutput>('GET', '/v1/agents', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    model: {
      list: (input, requestOptions) =>
        request<ClaraModelListOutput>('GET', '/v1/models', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    provider: {
      list: (input, requestOptions) =>
        request<ClaraProviderListOutput>('GET', '/v1/providers', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    command: {
      list: (input, requestOptions) =>
        request<ClaraCommandListOutput>('GET', '/v1/commands', {
          query: { harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    skill: {
      list: (input, requestOptions) =>
        request<ClaraSkillListOutput>('GET', '/v1/skills', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    reference: {
      list: (input, requestOptions) =>
        request<ClaraReferenceListOutput>('GET', '/v1/references', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
    },
    file: {
      find: (input, requestOptions) =>
        request<ClaraFileFindOutput>('GET', '/v1/files/find', {
          query: {
            directory: input.location?.directory,
            harnessID: input.harnessID,
            query: input.query,
            type: input.type,
            limit: input.limit,
          },
          options: requestOptions,
        }),
    },
    vcs: {
      get: (input, requestOptions) =>
        request<ClaraVcsGetOutput>('GET', '/v1/vcs', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
      base: (input, requestOptions) =>
        request<ClaraVcsBaseOutput>('GET', '/v1/vcs/base', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
      status: (input, requestOptions) =>
        request<ClaraVcsStatusOutput>('GET', '/v1/vcs/status', {
          query: { directory: input?.location?.directory, harnessID: input?.harnessID },
          options: requestOptions,
        }),
      diff: (input, requestOptions) =>
        request<ClaraVcsDiffOutput>('GET', '/v1/vcs/diff', {
          query: {
            directory: input.location?.directory,
            harnessID: input.harnessID,
            mode: input.mode,
            base: input.base,
            context: input.context,
          },
          options: requestOptions,
        }),
    },
    worktree: {
      list: (input, requestOptions) =>
        request<ClaraWorktree[]>('GET', '/v1/worktrees', {
          query: { project: input?.projectID },
          options: requestOptions,
        }),
      refresh: (input, requestOptions) =>
        request<void>('POST', '/v1/worktrees/refresh', {
          body: input,
          options: requestOptions,
        }),
    },
    git: {
      log: (input, requestOptions) =>
        request<GitCommit[]>('GET', '/v1/git/log', {
          query: {
            directory: input.directory,
            harnessID: input.harnessID,
            since: input.since,
            until: input.until,
          },
          options: requestOptions,
        }),
    },
    event: {
      subscribe: (requestOptions) => subscribeEvents(fetch, baseUrl, requestOptions),
    },
  }
}
