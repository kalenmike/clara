import { describe, expect, it } from 'vitest'
import {
  mergeAgents,
  mergeCommands,
  mergePlugins,
  mergeSkills,
  type ClaudeCommandEntry,
  type ClaudeSkillEntry,
} from '../src/catalog-merge.ts'

const commands: ClaudeCommandEntry[] = [
  { name: 'review', description: 'Review the diff' },
  { name: 'dataviz', description: 'Build a chart' },
]

describe('Claude catalog merges', () => {
  it('keeps command descriptions when a live turn reports names only', () => {
    expect(mergeCommands(commands, ['review', 'dataviz', 'new'])).toEqual([
      { name: 'review', description: 'Review the diff' },
      { name: 'dataviz', description: 'Build a chart' },
      { name: 'new' },
    ])
  })

  it('keeps agent descriptions when a live turn reports names only', () => {
    expect(
      mergeAgents([{ name: 'Explore', description: 'Search', model: 'inherit' }], ['Explore'])
    ).toEqual([{ name: 'Explore', description: 'Search', model: 'inherit' }])
  })

  it('keeps the previous catalog when an older harness reports no names', () => {
    expect(mergeCommands(commands, [])).toEqual(commands)
  })

  it('adds skills from init names using a matching command description', () => {
    const existing: ClaudeSkillEntry[] = [
      { id: 'review', name: 'review', description: 'Review the diff', path: '/s', content: 'body' },
    ]
    const result = mergeSkills(existing, ['review', 'dataviz'], commands)
    expect(result[0]).toEqual(existing[0])
    expect(result[1]).toEqual({
      id: 'dataviz',
      name: 'dataviz',
      description: 'Build a chart',
      path: '',
      content: 'Build a chart',
    })
  })

  it('deduplicates plugin names and keeps their version', () => {
    expect(
      mergePlugins(
        [],
        [
          { name: 'alpha', path: '/a', version: '1.0.0' },
          { name: 'alpha', path: '/a2' },
          { name: 'beta', path: '/b' },
        ]
      )
    ).toEqual([
      { name: 'alpha', path: '/a', version: '1.0.0' },
      { name: 'beta', path: '/b' },
    ])
  })
})
