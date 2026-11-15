import { describe, expect, it } from 'vitest'
import { commands, renderHelp } from '../src/cli.ts'

describe('command help', () => {
  it('lists every public command', () => {
    const help = renderHelp()
    for (const command of commands) expect(help).toContain(command.name)
    expect(help).toContain('clara start')
    expect(help).toContain('clara pair hub')
  })

  it('renders usage and options for one command', () => {
    const help = renderHelp('start')
    expect(help).toContain('Start the local stack')
    expect(help).toContain('clara start [hub|engine|web|lab]')
    expect(help).toContain('--foreground')
  })

  it('reports an unknown command without throwing', () => {
    expect(renderHelp('nope')).toContain('unknown command: nope')
  })

  it('does not list hidden dispatch commands', () => {
    const help = renderHelp()
    expect(help).not.toContain('__serve')
    expect(help).not.toContain('__supervise')
  })
})
