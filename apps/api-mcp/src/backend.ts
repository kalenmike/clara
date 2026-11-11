import type {
  ClaraApiReadBackend,
  FileFindQuery,
  GitLogQuery,
  MessageListQuery,
  SessionListQuery,
  VcsDiffQuery,
} from '@clara/api-mcp'

export class HttpBackend implements ClaraApiReadBackend {
  readonly baseURL: string
  readonly token: string

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL.replace(/\/$/, '')
    this.token = token
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseURL}${path}`)
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
        continue
      }
      url.searchParams.append(key, String(value))
    }

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.token}`,
        'x-clara-readonly': '1',
      },
    })
    const body = await response.text()
    let parsed: unknown
    try {
      parsed = body ? JSON.parse(body) : undefined
    } catch {
      parsed = body
    }
    if (!response.ok) {
      const error = parsed as { error?: { message?: string } } | undefined
      throw new Error(error?.error?.message ?? `Clara API returned ${response.status}`)
    }
    return parsed as T
  }

  info() {
    return this.get('/v1/info')
  }

  openapi() {
    return this.get('/openapi.json')
  }

  harnessInfo() {
    return this.get('/v1/harness/info')
  }

  projects(input?: { archived?: boolean }) {
    return this.get('/v1/projects', input)
  }

  sessions(input?: SessionListQuery) {
    return this.get('/v1/sessions', input)
  }

  activeSessions() {
    return this.get('/v1/sessions/active')
  }

  session(sessionID: string) {
    return this.get(`/v1/sessions/${encodeURIComponent(sessionID)}`)
  }

  messages(sessionID: string, input?: MessageListQuery) {
    return this.get(`/v1/sessions/${encodeURIComponent(sessionID)}/messages`, input)
  }

  permissions(input?: { directory?: string }) {
    return this.get('/v1/permissions', input)
  }

  forms(sessionID: string) {
    return this.get(`/v1/sessions/${encodeURIComponent(sessionID)}/forms`)
  }

  inbox(sessionID: string) {
    return this.get(`/v1/sessions/${encodeURIComponent(sessionID)}/inbox`)
  }

  agents() {
    return this.get('/v1/agents')
  }

  models() {
    return this.get('/v1/models')
  }

  providers() {
    return this.get('/v1/providers')
  }

  commands() {
    return this.get('/v1/commands')
  }

  skills(input?: { directory?: string }) {
    return this.get('/v1/skills', input)
  }

  references(input?: { directory?: string }) {
    return this.get('/v1/references', input)
  }

  location(directory?: string) {
    return this.get('/v1/locations', { directory })
  }

  files(input: FileFindQuery) {
    return this.get('/v1/files/find', input)
  }

  vcs(directory?: string) {
    return this.get('/v1/vcs', { directory })
  }

  vcsBase(directory?: string) {
    return this.get('/v1/vcs/base', { directory })
  }

  vcsStatus(directory?: string) {
    return this.get('/v1/vcs/status', { directory })
  }

  vcsDiff(input: VcsDiffQuery) {
    return this.get('/v1/vcs/diff', input)
  }

  worktrees(input?: { project?: string }) {
    return this.get('/v1/worktrees', input)
  }

  gitLog(input: GitLogQuery) {
    return this.get('/v1/git/log', input)
  }
}
