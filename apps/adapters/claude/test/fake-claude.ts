import type {
  ClaudeCatalog,
  ClaudeGateway,
  ClaudeSessionInfo,
  ClaudeSessionMessage,
  ClaudeTurn,
  ClaudeTurnRequest,
} from '../src/sdk.ts'

export class FakeClaudeGateway implements ClaudeGateway {
  sessions: ClaudeSessionInfo[] = []
  messages: ClaudeSessionMessage[] = []
  turns: ClaudeTurnRequest[] = []
  turn: ClaudeTurn = {
    push: () => {},
    interrupt: async () => {},
    setModel: async () => {},
  }

  async probe() {
    return { ok: true, latencyMs: 1, code: 'ok', version: '2.1.325' }
  }

  async auth() {
    return { loggedIn: true, authMethod: 'oauth' }
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
    return this.turn
  }

  async catalog(): Promise<ClaudeCatalog> {
    return { models: [], agents: [], commands: [], skills: [] }
  }

  lastInit(): ClaudeCatalog | undefined {
    return undefined
  }
}
