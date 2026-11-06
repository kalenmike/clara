import { describe, expect, it } from 'vitest'
import type { Pipeline } from '@clara/shared-types'
import {
  evidenceCount,
  formatCondition,
  formatGate,
  phaseColor,
  phaseLabel,
  stagePath,
  summaryParts,
} from './display'

const pipeline: Pipeline = {
  schemaVersion: 1,
  id: 'research',
  name: 'Research',
  version: 2,
  description: 'Gather, synthesize, review, deliver.',
  progressGuard: { metric: 'sources_found', samples: 3 },
  stages: [
    {
      id: 'gather',
      title: 'Gather',
      phase: 'contract',
      agent: 'researcher',
      role: 'worker',
      instructions: 'Collect sources.',
      evidence: {
        brief: { type: 'string', required: true },
      },
    },
    {
      id: 'synthesize',
      title: 'Synthesize',
      phase: 'work',
      agent: 'writer',
      role: 'worker',
      instructions: 'Write the draft.',
      when: { evidence: 'brief', notIn: ['', 'none', 'n/a', 'no'] },
      gate: { position: 'after', kind: 'human' },
    },
    {
      id: 'deliver',
      title: 'Deliver',
      phase: 'close',
      agent: 'judge',
      role: 'closer',
      instructions: 'Deliver.',
    },
  ],
}

describe('pipeline display helpers', () => {
  it('labels phases and gives each one a chart accent', () => {
    expect(phaseLabel('contract')).toBe('Contract')
    expect(phaseLabel('close')).toBe('Close')
    expect(phaseColor('work')).toBe('var(--chart-4)')
  })

  it('formats conditions in plain language', () => {
    expect(formatCondition(pipeline.stages[1].when)).toBe(
      'Runs when brief is not one of "", none, n/a, no'
    )
    expect(formatCondition(undefined)).toBe('Always runs')
    expect(formatCondition({ evidence: 'ready', exists: true })).toBe('Runs when ready has a value')
    expect(formatCondition({ evidence: 'mode', equals: 'full' })).toBe('Runs when mode equals full')
  })

  it('formats gates and stage paths', () => {
    expect(formatGate({ position: 'before', kind: 'human' })).toBe(
      'Human gate, before the stage starts'
    )
    expect(formatGate({ position: 'after', kind: 'human' })).toBe(
      'Human gate, after the stage finishes'
    )
    expect(stagePath(pipeline)).toBe('Gather → Synthesize → Deliver')
  })

  it('summarizes the pipeline and its evidence', () => {
    expect(summaryParts(pipeline)).toEqual([
      '3 stages',
      '1 human gate',
      '1 conditional',
      '1 closer',
      'guard sources_found × 3',
    ])
    expect(evidenceCount(pipeline.stages[0])).toBe(1)
    expect(evidenceCount(pipeline.stages[2])).toBe(0)
  })
})
