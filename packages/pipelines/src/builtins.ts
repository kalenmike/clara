import { PIPELINE_SCHEMA_VERSION, SOFTWARE_PIPELINE_ID, type Pipeline } from '@clara/shared-types'

/**
 * The built-in software pipeline. It mirrors the original five stages, so a
 * fresh ledger and the existing Clara agents keep working without a config
 * file. A user file with id `software` overrides it.
 */
export const SOFTWARE_PIPELINE: Pipeline = {
  schemaVersion: PIPELINE_SCHEMA_VERSION,
  id: SOFTWARE_PIPELINE_ID,
  name: 'Software request',
  version: 1,
  description: 'Spec, freeze tests, build, apply docs, close.',
  progressGuard: { metric: 'tests_passed', samples: 3 },
  stages: [
    {
      id: 'spec',
      title: 'Spec',
      phase: 'contract',
      agent: '001',
      role: 'worker',
      instructions:
        'Propose the acceptance criteria with clara_criteria. Every criterion needs a test_path or human_gate=true. Do not read source code; use the request record and the docs it points at. Then call clara_stage_done with {"criteria_count": <n>, "docs_impact": "<impact or none>"}. A human must approve.',
      evidence: {
        criteria_count: { type: 'number', required: true },
        docs_impact: { type: 'string' },
      },
    },
    {
      id: 'test',
      title: 'Test',
      phase: 'work',
      agent: '002',
      role: 'worker',
      instructions:
        'Write the tests that define done for the approved criteria. Use clara_ask to read them. Then call clara_stage_done with {"tests_hash": "<hash>", "tests_total": <n>}. The hash is immutable after that. Do not edit source.',
      evidence: {
        tests_hash: { type: 'string', required: true, immutable: true },
        tests_total: { type: 'number' },
      },
    },
    {
      id: 'build',
      title: 'Build',
      phase: 'work',
      agent: '003',
      role: 'worker',
      instructions:
        'Implement the request against the frozen tests. Use clara_progress at each boundary. Do not edit tests. When complete, call clara_stage_done with {"summary": "<what changed>", "criteria_addressed": [<positions>]}. If a kill criterion fires, write progress with blocked_on and stop.',
      evidence: {
        summary: { type: 'string', required: true },
        criteria_addressed: { type: 'array' },
      },
    },
    {
      id: 'docs',
      title: 'Docs',
      phase: 'review',
      agent: '004',
      role: 'worker',
      instructions:
        "Apply the request's docs_impact to the workspace docs. Never edit docs/features or docs/index.md. If the impact no longer applies cleanly, reconcile against current truth and record it. When done, call clara_stage_done for this stage. If you cannot reconcile, open a decision with clara_decide and stop.",
      when: { evidence: 'docs_impact', notIn: ['', 'none', 'n/a', 'no'] },
    },
    {
      id: 'judge',
      title: 'Judge',
      phase: 'close',
      agent: 'judge',
      role: 'closer',
      instructions:
        'Close only from ledger evidence: call clara_ask once and check the criteria, stage evidence, and human gates. Do not read source or run commands; there is no shell and the close gate does not re-hash. If every gate is recorded, call clara_stage_done with {"result": "<final result>", "artifacts": [<paths, URLs, or text>]}. Otherwise open one decision with clara_decide and stop. Do not write code.',
      evidence: {
        result: { type: 'string', required: true },
        artifacts: { type: 'array' },
      },
    },
  ],
}

/**
 * A small non-software example. It exists to prove the daemon is not tied to
 * tests or docs, and to give authors something to copy.
 */
export const CONTENT_PIPELINE: Pipeline = {
  schemaVersion: PIPELINE_SCHEMA_VERSION,
  id: 'content',
  name: 'Content request',
  version: 1,
  description: 'Brief, draft, edit, deliver.',
  stages: [
    {
      id: 'brief',
      title: 'Brief',
      phase: 'contract',
      agent: 'clara-brief',
      role: 'worker',
      instructions:
        'Turn the request into a content brief with clara_criteria. Include audience, tone, length, and the call to action. Every criterion needs a human_gate or an artifact reference. Then call clara_stage_done with {"brief": "<brief>"}.',
      evidence: {
        brief: { type: 'string', required: true },
      },
    },
    {
      id: 'draft',
      title: 'Draft',
      phase: 'work',
      agent: 'clara-writer',
      role: 'worker',
      instructions:
        'Write the draft from the approved brief. Call clara_stage_done with {"copy": "<draft>", "word_count": <n>}.',
      evidence: {
        copy: { type: 'string', required: true },
        word_count: { type: 'number' },
      },
      gate: { position: 'after', kind: 'human' },
    },
    {
      id: 'edit',
      title: 'Edit',
      phase: 'review',
      agent: 'clara-editor',
      role: 'worker',
      instructions:
        'Edit the draft against the brief. Call clara_stage_done with {"final_copy": "<final copy>", "changes": "<summary>"}.',
      evidence: {
        final_copy: { type: 'string', required: true },
        changes: { type: 'string' },
      },
    },
    {
      id: 'deliver',
      title: 'Deliver',
      phase: 'close',
      agent: 'judge',
      role: 'closer',
      instructions:
        'Deliver the final copy. Call clara_stage_done with {"result": "<delivery summary>", "artifacts": [<paths or URLs>]} to complete the request.',
      evidence: {
        result: { type: 'string', required: true },
        artifacts: { type: 'array' },
      },
    },
  ],
}
