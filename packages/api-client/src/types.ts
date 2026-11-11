import type { OpenCodeClient, WorktreeList } from '@opencode/client'
import type { ApiInfo, GitCommit, GitLogQuery } from '@clara/api-contract'

export type RequestOptions = {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit['headers']
  /** Reports every chunk a streaming response receives, including keepalive comments. */
  readonly onActivity?: () => void
}

/**
 * The subset of the OpenCode client that Clara implements. Reusing the
 * OpenCode method signatures keeps the web migration mechanical and prevents
 * the SDK from drifting from the harness contract.
 */
export type ClaraClient = {
  server: {
    info: OpenCodeClient['server']['info']
    status: (options?: RequestOptions) => Promise<ApiInfo>
    openapi: (options?: RequestOptions) => Promise<Record<string, unknown>>
  }
  project: Pick<OpenCodeClient['project'], 'list' | 'update'>
  location: Pick<OpenCodeClient['location'], 'get'>
  session: Pick<
    OpenCodeClient['session'],
    | 'list'
    | 'get'
    | 'create'
    | 'update'
    | 'remove'
    | 'fork'
    | 'move'
    | 'view'
    | 'prompt'
    | 'synthetic'
    | 'command'
    | 'interrupt'
    | 'compact'
    | 'switchAgent'
    | 'switchModel'
    | 'context'
    | 'active'
  > & {
    form: Pick<OpenCodeClient['session']['form'], 'list' | 'reply' | 'cancel'>
    inbox: Pick<OpenCodeClient['session']['inbox'], 'list' | 'cancel'>
  }
  message: Pick<OpenCodeClient['message'], 'list'>
  permission: Pick<OpenCodeClient['permission'], 'reply'> & {
    request: Pick<OpenCodeClient['permission']['request'], 'list'>
  }
  agent: Pick<OpenCodeClient['agent'], 'list'>
  model: Pick<OpenCodeClient['model'], 'list'>
  provider: Pick<OpenCodeClient['provider'], 'list'>
  command: Pick<OpenCodeClient['command'], 'list'>
  skill: Pick<OpenCodeClient['skill'], 'list'>
  reference: Pick<OpenCodeClient['reference'], 'list'>
  file: Pick<OpenCodeClient['file'], 'find'>
  vcs: Pick<OpenCodeClient['vcs'], 'get' | 'base' | 'status' | 'diff'>
  worktree: {
    list: (input?: { projectID?: string }, options?: RequestOptions) => Promise<WorktreeList>
    refresh: OpenCodeClient['worktree']['refresh']
  }
  git: {
    log: (input: GitLogQuery, options?: RequestOptions) => Promise<GitCommit[]>
  }
  event: Pick<OpenCodeClient['event'], 'subscribe'>
}

export type ClaraClientOptions = {
  fetch: typeof globalThis.fetch
  /** Base URL used to build request URLs. The fetch shim decides the transport. */
  baseUrl?: string
}
