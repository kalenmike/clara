import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isSelectableAgent,
  resolveDefaultAgent,
  type AgentOption,
  type DefaultAgentSettings,
} from './default-agent'

const AGENTS: AgentOption[] = [
  { id: 'build', hidden: false, mode: 'primary' },
  { id: 'plan', hidden: false, mode: 'primary' },
  { id: 'explore', hidden: false, mode: 'subagent' },
  { id: 'legacy', hidden: true, mode: 'primary' },
]

function fixed(agent: string | null): DefaultAgentSettings {
  return { mode: 'fixed', agent }
}

describe('isSelectableAgent', () => {
  it('rejects hidden and subagent agents', () => {
    expect(isSelectableAgent(AGENTS, 'build')).toBe(true)
    expect(isSelectableAgent(AGENTS, 'explore')).toBe(false)
    expect(isSelectableAgent(AGENTS, 'legacy')).toBe(false)
    expect(isSelectableAgent(AGENTS, 'missing')).toBe(false)
  })

  it('trusts the stored choice until the catalog loads', () => {
    expect(isSelectableAgent(undefined, 'build')).toBe(true)
  })
})

describe('resolveDefaultAgent', () => {
  it('uses the last selected agent in last-used mode', () => {
    expect(
      resolveDefaultAgent({
        settings: DEFAULT_AGENT_SETTINGS,
        lastAgent: 'plan',
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('plan')
  })

  it('falls back to the latest session agent when nothing was selected yet', () => {
    expect(
      resolveDefaultAgent({
        settings: DEFAULT_AGENT_SETTINGS,
        lastAgent: null,
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('build')
  })

  it('uses the fixed agent when it is available', () => {
    expect(
      resolveDefaultAgent({
        settings: fixed('plan'),
        lastAgent: 'build',
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('plan')
  })

  it('falls back to the last used agent when the fixed agent disappeared', () => {
    expect(
      resolveDefaultAgent({
        settings: fixed('legacy'),
        lastAgent: 'plan',
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('plan')
  })

  it('falls back to the latest session agent when both stored agents vanished', () => {
    expect(
      resolveDefaultAgent({
        settings: fixed('missing'),
        lastAgent: 'explore',
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('build')
  })

  it('uses the stored fixed agent before the catalog loads', () => {
    expect(
      resolveDefaultAgent({
        settings: fixed('plan'),
        lastAgent: null,
        fallbackAgent: 'build',
      })
    ).toBe('plan')
  })

  it('skips hidden fallback agents', () => {
    expect(
      resolveDefaultAgent({
        settings: DEFAULT_AGENT_SETTINGS,
        lastAgent: 'legacy',
        fallbackAgent: 'build',
        agents: AGENTS,
      })
    ).toBe('build')
  })
})
