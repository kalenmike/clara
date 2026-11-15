import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TerminalEntryView } from '@/components/chat/pair-terminal'
import type { TerminalEntry } from '@/features/chat/terminal-log'

const command: TerminalEntry = {
  kind: 'command',
  id: 'tool:message:tool-1',
  command: 'pnpm test',
  description: 'Run the test suite',
  output: 'all green',
  status: 'completed',
  exit: 0,
  started: 1,
  completed: 2,
}

function render(entry: TerminalEntry, expanded: boolean) {
  return renderToStaticMarkup(
    <TerminalEntryView entry={entry} expanded={expanded} onToggle={() => {}} />
  )
}

describe('pair terminal command rows', () => {
  it('folds command output by default', () => {
    const html = render(command, false)

    expect(html).toContain('pnpm test')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('all green')
    expect(html).not.toContain('terminal-result-')
  })

  it('opens the command output when expanded', () => {
    const html = render(command, true)

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('all green')
    expect(html).toContain('id="terminal-result-tool:message:tool-1"')
  })

  it('folds the error of a failed command', () => {
    const failed: TerminalEntry = {
      ...command,
      output: undefined,
      status: 'error',
      error: 'command not found',
    }

    expect(render(failed, false)).not.toContain('command not found')
    expect(render(failed, false)).toContain('failed')
    expect(render(failed, true)).toContain('command not found')
  })

  it('does not make a command without results interactive', () => {
    const quiet: TerminalEntry = {
      ...command,
      output: undefined,
      error: undefined,
      status: 'running',
      completed: undefined,
    }
    const html = render(quiet, false)

    expect(html).not.toContain('<button')
    expect(html).toContain('running')
  })
})
