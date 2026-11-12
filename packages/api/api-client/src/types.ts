import type {
  ApiInfo,
  ClaraAgentListOutput,
  ClaraCommandListOutput,
  ClaraEvent,
  ClaraFileFindOutput,
  ClaraForm,
  ClaraHarnessConnection,
  ClaraLocation,
  ClaraModelListOutput,
  ClaraModelRef,
  ClaraPermissionRequestListOutput,
  ClaraPermissionRule,
  ClaraProject,
  ClaraProjectArchiveResult,
  ClaraProjectAvailable,
  ClaraProjectDeleteResult,
  ClaraProviderListOutput,
  ClaraReferenceListOutput,
  ClaraServerInfo,
  ClaraSession,
  ClaraSessionActiveOutput,
  ClaraSessionInboxCompaction,
  ClaraSessionInboxInfo,
  ClaraSessionInboxSynthetic,
  ClaraSessionInboxUser,
  ClaraSessionInterruptResponse,
  ClaraSessionMessage,
  ClaraSessionMessageType,
  ClaraSessionMessagesResponse,
  ClaraSessionMetadata,
  ClaraSessionsResponse,
  ClaraSkillListOutput,
  ClaraVcsBaseOutput,
  ClaraVcsDiffOutput,
  ClaraVcsGetOutput,
  ClaraVcsStatusOutput,
  ClaraWorktree,
  GitCommit,
  GitLogQuery,
} from '@clara/api-contract'

export type RequestOptions = {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit['headers']
  /** Reports every chunk a streaming response receives, including keepalive comments. */
  readonly onActivity?: () => void
}

export type ClaraLocationInput = {
  readonly location?: {
    readonly directory?: string
  }
}

export type ClaraProjectListInput = {
  readonly archived?: boolean
}

export type ClaraProjectCreateInput = {
  readonly name?: string
  readonly icon?: Record<string, unknown>
  readonly commands?: Record<string, unknown>
  readonly startupScript?: string
}

export type ClaraProjectUpdateInput = {
  readonly projectID: string
  readonly name?: string
  readonly icon?: Record<string, unknown>
  readonly commands?: Record<string, unknown>
  readonly startupScript?: string
  readonly defaultWorkspaceID?: string | null
}

export type ClaraProjectDeleteInput = {
  readonly projectID: string
  readonly mode?: 'propagate' | 'disconnect'
}

export type ClaraProjectAvailableInput = {
  readonly harnessID?: string
}

export type ClaraProjectWorkspaceCreateInput = {
  readonly projectID: string
  readonly harnessID: string
  readonly directory: string
  readonly label?: string
}

export type ClaraProjectWorkspaceRemoveInput = {
  readonly projectID: string
  readonly workspaceID: string
}

export type ClaraPromptMentionInput = {
  readonly start: number
  readonly end: number
  readonly text: string
}

export type ClaraPromptFileInput = {
  readonly uri: string
  readonly name?: string
  readonly description?: string
  readonly mention?: ClaraPromptMentionInput
}

export type ClaraPromptAgentInput = {
  readonly name: string
  readonly mention?: ClaraPromptMentionInput
}

export type ClaraPromptSkillInput = {
  readonly id: string
  readonly mention?: ClaraPromptMentionInput
}

export type ClaraSessionListInput = {
  readonly limit?: number
  readonly order?: 'asc' | 'desc'
  readonly search?: string
  readonly parentID?: string | null
  readonly archived?: boolean
  readonly directory?: string
  readonly project?: string
  readonly subpath?: string
  readonly cursor?: string
}

export type ClaraSessionCreateInput = {
  readonly id?: string | null
  readonly parentID?: string | null
  readonly title?: string | null
  readonly agent?: string | null
  readonly model?: ClaraModelRef | null
  readonly location?: { readonly directory: string } | null
  readonly metadata?: ClaraSessionMetadata | null
  readonly permissions?: readonly ClaraPermissionRule[] | null
}

export type ClaraSessionUpdateInput = {
  readonly sessionID: string
  readonly title?: string
  readonly metadata?: ClaraSessionMetadata
  readonly permissions?: readonly ClaraPermissionRule[]
  readonly archived?: boolean
}

export type ClaraSessionForkInput = {
  readonly sessionID: string
  readonly before?: string
}

export type ClaraSessionMoveInput = {
  readonly sessionID: string
  readonly directory: string
  readonly delivery?: 'steer' | 'queue'
}

export type ClaraSessionViewInput = {
  readonly sessionID: string
  readonly idle: number
}

export type ClaraSessionPromptInput = {
  readonly sessionID: string
  readonly id?: string | null
  readonly text: string
  readonly files?: readonly ClaraPromptFileInput[]
  readonly agents?: readonly ClaraPromptAgentInput[]
  readonly skills?: readonly ClaraPromptSkillInput[]
  readonly metadata?: ClaraSessionMetadata
  readonly delivery?: 'steer' | 'queue' | null
  readonly resume?: boolean | null
}

export type ClaraSessionSyntheticInput = {
  readonly sessionID: string
  readonly id?: string | null
  readonly text: string
  readonly description?: string | null
  readonly metadata?: ClaraSessionMetadata
  readonly delivery?: 'steer' | 'queue' | null
  readonly resume?: boolean | null
}

export type ClaraSessionCommandInput = {
  readonly sessionID: string
  readonly name: string
  readonly text: string
  readonly files?: readonly ClaraPromptFileInput[]
  readonly agents?: readonly ClaraPromptAgentInput[]
  readonly skills?: readonly ClaraPromptSkillInput[]
  readonly delivery?: 'steer' | 'queue'
}

export type ClaraSessionInterruptInput = {
  readonly sessionID: string
  readonly resume?: boolean
}

export type ClaraSessionCompactInput = {
  readonly sessionID: string
  readonly id?: string
  readonly delivery?: 'steer' | 'queue'
}

export type ClaraSessionSwitchAgentInput = {
  readonly sessionID: string
  readonly agent: string
}

export type ClaraSessionSwitchModelInput = {
  readonly sessionID: string
  readonly model: ClaraModelRef
}

export type ClaraMessageListInput = {
  readonly sessionID: string
  readonly limit?: number
  readonly order?: 'asc' | 'desc'
  readonly cursor?: string
  readonly type?: ClaraSessionMessageType
}

export type ClaraSessionFormListInput = {
  readonly sessionID: string
}

export type ClaraSessionFormReplyInput = {
  readonly sessionID: string
  readonly formID: string
  readonly answer: Record<string, string | number | boolean | string[]>
}

export type ClaraSessionFormCancelInput = {
  readonly sessionID: string
  readonly formID: string
  readonly message?: string
}

export type ClaraSessionInboxListInput = {
  readonly sessionID: string
}

export type ClaraSessionInboxCancelInput = {
  readonly sessionID: string
  readonly inboxID: string
}

export type ClaraPermissionReplyInput = {
  readonly sessionID: string
  readonly requestID: string
  readonly decision: 'once' | 'always' | 'reject'
  readonly message?: string
}

export type ClaraFileFindInput = {
  readonly location?: {
    readonly directory?: string
  }
  readonly query: string
  readonly type?: 'file' | 'directory'
  readonly limit?: number
}

export type ClaraVcsDiffInput = {
  readonly location?: {
    readonly directory?: string
  }
  readonly mode: 'working' | 'branch' | 'committed'
  readonly base?: string
  readonly context?: number
}

export type ClaraWorktreeListInput = {
  readonly projectID?: string
}

export type ClaraWorktreeRefreshInput = {
  readonly projectID: string
}

/**
 * The Clara SDK surface. Method names mirror the harness client so call sites
 * stay mechanical, but every value crossing this boundary is a Clara DTO.
 */
export type ClaraClient = {
  server: {
    info: (options?: RequestOptions) => Promise<ClaraServerInfo>
    status: (options?: RequestOptions) => Promise<ApiInfo>
    openapi: (options?: RequestOptions) => Promise<Record<string, unknown>>
  }
  harness: {
    list: (options?: RequestOptions) => Promise<ClaraHarnessConnection[]>
  }
  project: {
    list: (input?: ClaraProjectListInput, options?: RequestOptions) => Promise<ClaraProject[]>
    create: (input?: ClaraProjectCreateInput, options?: RequestOptions) => Promise<ClaraProject>
    update: (input: ClaraProjectUpdateInput, options?: RequestOptions) => Promise<ClaraProject>
    archive: (
      input: { readonly projectID: string },
      options?: RequestOptions
    ) => Promise<ClaraProjectArchiveResult>
    unarchive: (
      input: { readonly projectID: string },
      options?: RequestOptions
    ) => Promise<ClaraProjectArchiveResult>
    remove: (
      input: ClaraProjectDeleteInput,
      options?: RequestOptions
    ) => Promise<ClaraProjectDeleteResult>
    sync: (input: { readonly projectID: string }, options?: RequestOptions) => Promise<ClaraProject>
    available: (
      input?: ClaraProjectAvailableInput,
      options?: RequestOptions
    ) => Promise<ClaraProjectAvailable[]>
    workspace: {
      add: (
        input: ClaraProjectWorkspaceCreateInput,
        options?: RequestOptions
      ) => Promise<ClaraProject>
      remove: (input: ClaraProjectWorkspaceRemoveInput, options?: RequestOptions) => Promise<void>
    }
  }
  location: {
    get: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraLocation>
  }
  session: {
    list: (
      input?: ClaraSessionListInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionsResponse>
    get: (input: { sessionID: string }, options?: RequestOptions) => Promise<ClaraSession>
    create: (input?: ClaraSessionCreateInput, options?: RequestOptions) => Promise<ClaraSession>
    update: (input: ClaraSessionUpdateInput, options?: RequestOptions) => Promise<void>
    remove: (input: { sessionID: string }, options?: RequestOptions) => Promise<void>
    fork: (input: ClaraSessionForkInput, options?: RequestOptions) => Promise<ClaraSession>
    move: (input: ClaraSessionMoveInput, options?: RequestOptions) => Promise<void>
    view: (input: ClaraSessionViewInput, options?: RequestOptions) => Promise<void>
    prompt: (
      input: ClaraSessionPromptInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionInboxUser>
    synthetic: (
      input: ClaraSessionSyntheticInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionInboxSynthetic>
    command: (input: ClaraSessionCommandInput, options?: RequestOptions) => Promise<void>
    interrupt: (
      input: ClaraSessionInterruptInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionInterruptResponse>
    compact: (
      input: ClaraSessionCompactInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionInboxCompaction>
    switchAgent: (input: ClaraSessionSwitchAgentInput, options?: RequestOptions) => Promise<void>
    switchModel: (input: ClaraSessionSwitchModelInput, options?: RequestOptions) => Promise<void>
    context: (
      input: { sessionID: string },
      options?: RequestOptions
    ) => Promise<ClaraSessionMessage[]>
    active: (options?: RequestOptions) => Promise<ClaraSessionActiveOutput>
    form: {
      list: (input: ClaraSessionFormListInput, options?: RequestOptions) => Promise<ClaraForm[]>
      reply: (input: ClaraSessionFormReplyInput, options?: RequestOptions) => Promise<void>
      cancel: (input: ClaraSessionFormCancelInput, options?: RequestOptions) => Promise<void>
    }
    inbox: {
      list: (
        input: ClaraSessionInboxListInput,
        options?: RequestOptions
      ) => Promise<ClaraSessionInboxInfo[]>
      cancel: (input: ClaraSessionInboxCancelInput, options?: RequestOptions) => Promise<void>
    }
  }
  message: {
    list: (
      input: ClaraMessageListInput,
      options?: RequestOptions
    ) => Promise<ClaraSessionMessagesResponse>
  }
  permission: {
    reply: (input: ClaraPermissionReplyInput, options?: RequestOptions) => Promise<void>
    request: {
      list: (
        input?: ClaraLocationInput,
        options?: RequestOptions
      ) => Promise<ClaraPermissionRequestListOutput>
    }
  }
  agent: {
    list: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraAgentListOutput>
  }
  model: {
    list: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraModelListOutput>
  }
  provider: {
    list: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraProviderListOutput>
  }
  command: {
    list: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraCommandListOutput>
  }
  skill: {
    list: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraSkillListOutput>
  }
  reference: {
    list: (
      input?: ClaraLocationInput,
      options?: RequestOptions
    ) => Promise<ClaraReferenceListOutput>
  }
  file: {
    find: (input: ClaraFileFindInput, options?: RequestOptions) => Promise<ClaraFileFindOutput>
  }
  vcs: {
    get: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraVcsGetOutput>
    base: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraVcsBaseOutput>
    status: (input?: ClaraLocationInput, options?: RequestOptions) => Promise<ClaraVcsStatusOutput>
    diff: (input: ClaraVcsDiffInput, options?: RequestOptions) => Promise<ClaraVcsDiffOutput>
  }
  worktree: {
    list: (input?: ClaraWorktreeListInput, options?: RequestOptions) => Promise<ClaraWorktree[]>
    refresh: (input: ClaraWorktreeRefreshInput, options?: RequestOptions) => Promise<void>
  }
  git: {
    log: (input: GitLogQuery, options?: RequestOptions) => Promise<GitCommit[]>
  }
  event: {
    subscribe: (options?: RequestOptions) => AsyncIterable<ClaraEvent>
  }
}

export type ClaraClientOptions = {
  fetch: typeof globalThis.fetch
  /** Base URL used to build request URLs. The fetch shim decides the transport. */
  baseUrl?: string
}
