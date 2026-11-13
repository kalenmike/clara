import type {
  ClaudeCatalog,
  ClaudeTurnEvent,
  ClaudeGateway,
  ClaudeSessionInfo,
  ClaudeSessionMessage,
  ClaudeTurn,
  ClaudeTurnRequest,
} from '../src/sdk.ts'

export type Script = (
  request: ClaudeTurnRequest,
  emit: (event: ClaudeTurnEvent) => void
) => void | Promise<void>

export class FakeClaudeGateway implements ClaudeGateway {
  sessions: ClaudeSessionInfo[] = []
  messages: ClaudeSessionMessage[] = []
  turns: ClaudeTurnRequest[] = []
  projectsDirectory?: string
  script?: Script
  turn: ClaudeTurn = {
    push: () => {},
    interrupt: async () => {},
    setModel: async () => {},
    close: () => {},
  }

  async probe() {
    return { ok: true, latencyMs: 1, code: 'ok', version: '2.1.325' }
  }

  async auth() {
    return {
      loggedIn: true,
      authMethod: 'oauth',
      ...(this.projectsDirectory ? { projectsDirectory: this.projectsDirectory } : {}),
    }
  }

  installation() {
    return { binary: '/usr/local/bin/claude', source: 'path' as const }
  }

  async listSessions() {
    return this.sessions
  }

  async getSessionInfo(sessionId: string) {
    return this.sessions.find((session) => session.sessionId === sessionId)
  }

  async getSessionMessages() {
    return this.messages
  }

  async forkSession() {
    return 'forked-session'
  }

  async renameSession() {}

  async deleteSession() {}

  async startTurn(request: ClaudeTurnRequest) {
    this.turns.push(request)
    if (this.script) {
      void Promise.resolve()
        .then(() => this.script?.(request, request.onEvent))
        .catch(() => {})
    }
    return this.turn
  }

  async catalog(): Promise<ClaudeCatalog> {
    return { models: [], agents: [], commands: [], skills: [] }
  }

  lastInit(): ClaudeCatalog | undefined {
    return undefined
  }
}
