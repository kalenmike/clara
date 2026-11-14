import type {
  ClaudeCatalog,
  ClaudeTurnEvent,
  ClaudeGateway,
  ClaudeSessionInfo,
  ClaudeSessionMessage,
  ClaudeTurn,
  ClaudeTurnRequest,
} from '../src/sdk.ts'
import type { ClaudeProvider } from '../src/provider.ts'

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
  providerValue: ClaudeProvider = { id: 'anthropic', name: 'Anthropic' }
  defaultModelValue?: string
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

  provider(): ClaudeProvider {
    return this.providerValue
  }

  defaultModel(): string | undefined {
    return this.defaultModelValue
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
    return {
      provider: this.providerValue,
      ...(this.defaultModelValue ? { defaultModel: this.defaultModelValue } : {}),
      models: [],
      agents: [],
      commands: [],
      skills: [],
    }
  }

  lastInit(): ClaudeCatalog | undefined {
    return undefined
  }
}
