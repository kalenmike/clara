import type {
  AgentListOutput,
  CommandListOutput,
  FileFindOutput,
  FormInfo,
  LocationPublicInfo,
  ModelListOutput,
  PermissionRequestListOutput,
  Project,
  ProviderListOutput,
  ReferenceListOutput,
  ServerInfo,
  SessionActive,
  SessionInboxCompaction,
  SessionInboxInfo,
  SessionInboxSynthetic,
  SessionInboxUser,
  SessionInfo,
  SessionInterruptResponse,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionsResponse,
  SkillListOutput,
  VcsBaseOutput,
  VcsDiffOutput,
  VcsGetOutput,
  VcsStatusOutput,
  WorktreeList,
} from '@opencode/client'
import type { ApiInfo, GitCommit } from '@clara/api-contract'
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
        request<ServerInfo>('GET', '/v1/harness/info', { options: requestOptions }),
      status: (requestOptions) => request<ApiInfo>('GET', '/v1/info', { options: requestOptions }),
      openapi: (requestOptions) =>
        request<Record<string, unknown>>('GET', '/openapi.json', { options: requestOptions }),
    },
    project: {
      list: (input, requestOptions) =>
        request<Project[]>('GET', '/v1/projects', {
          query: { archived: input?.archived },
          options: requestOptions,
        }),
      update: (input, requestOptions) => {
        const { projectID, ...body } = input
        return request<Project>('PATCH', `/v1/projects/${encodeURIComponent(projectID)}`, {
          body,
          options: requestOptions,
        })
      },
    },
    location: {
      get: (input, requestOptions) =>
        request<LocationPublicInfo>('GET', '/v1/locations', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
    },
    session: {
      list: (input, requestOptions) =>
        request<SessionsResponse>('GET', '/v1/sessions', {
          query: {
            limit: input?.limit,
            order: input?.order,
            search: input?.search,
            parentID: input?.parentID,
            archived: input?.archived,
            directory: input?.directory,
            project: input?.project,
            subpath: input?.subpath,
            cursor: input?.cursor,
          },
          options: requestOptions,
        }),
      get: (input, requestOptions) =>
        request<SessionInfo>('GET', `/v1/sessions/${encodeURIComponent(input.sessionID)}`, {
          options: requestOptions,
        }),
      create: (input, requestOptions) =>
        request<SessionInfo>('POST', '/v1/sessions', {
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
        return request<SessionInfo>('POST', `/v1/sessions/${encodeURIComponent(sessionID)}/fork`, {
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
        return request<SessionInboxUser>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/prompt`,
          { body, options: requestOptions }
        )
      },
      synthetic: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<SessionInboxSynthetic>(
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
        return request<SessionInterruptResponse>(
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionID)}/interrupt`,
          { body, options: requestOptions }
        )
      },
      compact: (input, requestOptions) => {
        const { sessionID, ...body } = input
        return request<SessionInboxCompaction>(
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
        request<SessionMessageInfo[]>(
          'GET',
          `/v1/sessions/${encodeURIComponent(input.sessionID)}/context`,
          { options: requestOptions }
        ),
      active: (requestOptions) =>
        request<Record<string, SessionActive>>('GET', '/v1/sessions/active', {
          options: requestOptions,
        }),
      form: {
        list: (input, requestOptions) =>
          request<FormInfo[]>('GET', `/v1/sessions/${encodeURIComponent(input.sessionID)}/forms`, {
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
          request<SessionInboxInfo[]>(
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
        return request<SessionMessagesResponse>(
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
          request<PermissionRequestListOutput>('GET', '/v1/permissions', {
            query: { directory: input?.location?.directory },
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
      list: (_input, requestOptions) =>
        request<AgentListOutput>('GET', '/v1/agents', { options: requestOptions }),
    },
    model: {
      list: (_input, requestOptions) =>
        request<ModelListOutput>('GET', '/v1/models', { options: requestOptions }),
    },
    provider: {
      list: (_input, requestOptions) =>
        request<ProviderListOutput>('GET', '/v1/providers', { options: requestOptions }),
    },
    command: {
      list: (_input, requestOptions) =>
        request<CommandListOutput>('GET', '/v1/commands', { options: requestOptions }),
    },
    skill: {
      list: (input, requestOptions) =>
        request<SkillListOutput>('GET', '/v1/skills', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
    },
    reference: {
      list: (input, requestOptions) =>
        request<ReferenceListOutput>('GET', '/v1/references', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
    },
    file: {
      find: (input, requestOptions) =>
        request<FileFindOutput>('GET', '/v1/files/find', {
          query: {
            directory: input.location?.directory,
            query: input.query,
            type: input.type,
            limit: input.limit,
          },
          options: requestOptions,
        }),
    },
    vcs: {
      get: (input, requestOptions) =>
        request<VcsGetOutput>('GET', '/v1/vcs', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
      base: (input, requestOptions) =>
        request<VcsBaseOutput>('GET', '/v1/vcs/base', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
      status: (input, requestOptions) =>
        request<VcsStatusOutput>('GET', '/v1/vcs/status', {
          query: { directory: input?.location?.directory },
          options: requestOptions,
        }),
      diff: (input, requestOptions) =>
        request<VcsDiffOutput>('GET', '/v1/vcs/diff', {
          query: {
            directory: input.location?.directory,
            mode: input.mode,
            base: input.base,
            context: input.context,
          },
          options: requestOptions,
        }),
    },
    worktree: {
      list: (input, requestOptions) =>
        request<WorktreeList>('GET', '/v1/worktrees', {
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
