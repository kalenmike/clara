export type SessionListQuery = {
  limit?: number
  order?: 'asc' | 'desc'
  search?: string
  parentID?: string
  archived?: boolean
  directory?: string
  project?: string
  subpath?: string
  cursor?: string
}

export type MessageListQuery = {
  order?: 'asc' | 'desc'
  limit?: number
  cursor?: string
  type?: string
}

export type FileFindQuery = {
  directory?: string
  query: string
  type?: 'file' | 'directory'
  limit?: number
}

export type VcsDiffQuery = {
  directory?: string
  mode: 'working' | 'branch' | 'committed'
  base?: string
  context?: number
}

export type GitLogQuery = {
  directory: string
  since: number
  until?: number
}

/**
 * Read-only view of the Clara hub API. The MCP never exposes mutations.
 */
export interface ClaraApiReadBackend {
  info(): Promise<unknown>
  openapi(): Promise<unknown>
  harnessInfo(): Promise<unknown>
  projects(input?: { archived?: boolean }): Promise<unknown>
  sessions(input?: SessionListQuery): Promise<unknown>
  activeSessions(): Promise<unknown>
  session(sessionID: string): Promise<unknown>
  messages(sessionID: string, input?: MessageListQuery): Promise<unknown>
  permissions(input?: { directory?: string }): Promise<unknown>
  forms(sessionID: string): Promise<unknown>
  inbox(sessionID: string): Promise<unknown>
  agents(): Promise<unknown>
  models(): Promise<unknown>
  providers(): Promise<unknown>
  commands(): Promise<unknown>
  skills(input?: { directory?: string }): Promise<unknown>
  references(input?: { directory?: string }): Promise<unknown>
  location(directory?: string): Promise<unknown>
  files(input: FileFindQuery): Promise<unknown>
  vcs(directory?: string): Promise<unknown>
  vcsBase(directory?: string): Promise<unknown>
  vcsStatus(directory?: string): Promise<unknown>
  vcsDiff(input: VcsDiffQuery): Promise<unknown>
  worktrees(input?: { project?: string }): Promise<unknown>
  gitLog(input: GitLogQuery): Promise<unknown>
}
