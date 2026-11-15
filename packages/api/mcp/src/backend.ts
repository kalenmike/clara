import { createClaraClient, type ClaraClient } from '@clara/api-client'
import type {
  ClaraApiReadBackend,
  FileFindQuery,
  GitLogQuery,
  MessageListQuery,
  SessionListQuery,
  VcsDiffQuery,
} from './types.ts'

export class HttpBackend implements ClaraApiReadBackend {
  private readonly client: ClaraClient

  constructor(baseURL: string, token: string) {
    this.client = createClaraClient({
      baseUrl: baseURL,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set('authorization', `Bearer ${token}`)
        headers.set('x-clara-readonly', '1')
        return fetch(input, { ...init, headers })
      },
    })
  }

  info() {
    return this.client.server.status()
  }

  openapi() {
    return this.client.server.openapi()
  }

  harnessInfo(harnessID: string) {
    return this.client.server.info({ harnessID })
  }

  projects(input?: { archived?: boolean }) {
    return this.client.project.list(input)
  }

  sessions(input?: SessionListQuery) {
    return this.client.session.list(input)
  }

  activeSessions() {
    return this.client.session.active()
  }

  session(sessionID: string) {
    return this.client.session.get({ sessionID })
  }

  messages(sessionID: string, input?: MessageListQuery) {
    return this.client.message.list({ sessionID, ...input })
  }

  permissions(input?: { directory?: string }) {
    return this.client.permission.request.list({
      location: { directory: input?.directory },
    })
  }

  forms(sessionID: string) {
    return this.client.session.form.list({ sessionID })
  }

  inbox(sessionID: string) {
    return this.client.session.inbox.list({ sessionID })
  }

  agents(harnessID: string) {
    return this.client.agent.list({ harnessID })
  }

  models(harnessID: string) {
    return this.client.model.list({ harnessID })
  }

  providers(harnessID: string) {
    return this.client.provider.list({ harnessID })
  }

  commands(harnessID: string) {
    return this.client.command.list({ harnessID })
  }

  skills(input: { harnessID: string; directory?: string }) {
    return this.client.skill.list({
      harnessID: input.harnessID,
      location: { directory: input.directory },
    })
  }

  references(input: { harnessID: string; directory?: string }) {
    return this.client.reference.list({
      harnessID: input.harnessID,
      location: { directory: input.directory },
    })
  }

  location(directory?: string) {
    return this.client.location.get({ location: { directory } })
  }

  files(input: FileFindQuery) {
    return this.client.file.find({
      location: { directory: input.directory },
      query: input.query,
      type: input.type,
      limit: input.limit,
    })
  }

  vcs(directory?: string) {
    return this.client.vcs.get({ location: { directory } })
  }

  vcsBase(directory?: string) {
    return this.client.vcs.base({ location: { directory } })
  }

  vcsStatus(directory?: string) {
    return this.client.vcs.status({ location: { directory } })
  }

  vcsDiff(input: VcsDiffQuery) {
    return this.client.vcs.diff({
      location: { directory: input.directory },
      mode: input.mode,
      base: input.base,
      context: input.context,
    })
  }

  worktrees(input?: { project?: string }) {
    return this.client.worktree.list({ projectID: input?.project })
  }

  gitLog(input: GitLogQuery) {
    return this.client.git.log(input)
  }
}
