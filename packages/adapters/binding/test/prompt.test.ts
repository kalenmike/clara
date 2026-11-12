import assert from 'node:assert/strict'
import test from 'node:test'
import { renderWorkPrompt, scopeWorkerTools, toolName } from '../src/prompt.ts'

const routerWork = {
  step_path: '1-classifier',
  kind: 'router',
  prompt: [
    '# Primary router',
    '',
    'Choose exactly one route.',
    '',
    '- `content` — a request to write, draft, edit, or deliver prose.',
    '- `software-development` — a normal software feature, bug, or docs request.',
  ].join('\n'),
  context: {
    prompt: 'Add a dark mode toggle to the settings page.',
  },
}

test('renders the root request and the compiled router prompt once', () => {
  const prompt = renderWorkPrompt(routerWork)
  assert.match(prompt, /Add a dark mode toggle/)
  assert.match(prompt, /# Request/)
  assert.doesNotMatch(prompt, /# Reference/)
  assert.equal(prompt.match(/`content`/g)?.length, 1)
  assert.match(prompt, /Call `clara_route`/)
  assert.doesNotMatch(prompt, /work_token/)
  assert.doesNotMatch(prompt, /model:/)
  assert.doesNotMatch(prompt, /enforcement:/)
  assert.doesNotMatch(prompt, /attempt:/)
  assert.doesNotMatch(prompt, /Clara work order/)
})

test('renders declared inputs with labels and full bodies', () => {
  const prompt = renderWorkPrompt({
    step_path: '4-review',
    kind: 'agent',
    prompt: '# Task: Review',
    context: {
      prompt: 'Add a dark mode toggle.',
      inputs: [
        { label: 'spec', path: '1-create_spec', name: 'create_spec', result: 'Spec body.' },
        {
          label: 'tests',
          path: '3-write_tests',
          name: 'write_tests',
          result: { command: 'pnpm test', passed: 12 },
        },
      ],
    },
  })
  assert.match(prompt, /# Inputs/)
  assert.match(prompt, /### spec — create_spec/)
  assert.match(prompt, /Spec body\./)
  assert.match(prompt, /### tests — write_tests/)
  assert.match(prompt, /"passed": 12/)
  assert.match(prompt, /call `clara_complete`/)
})

test('renders a declared input in full', () => {
  const body = 'z'.repeat(20_000)
  const prompt = renderWorkPrompt({
    step_path: '2-next',
    kind: 'agent',
    prompt: '# Task: Next',
    context: {
      prompt: 'do it',
      inputs: [{ label: 'evidence', path: '1-evidence', name: 'collect_evidence', result: body }],
    },
  })
  assert.match(prompt, /z{20000}/)
  assert.doesNotMatch(prompt, /truncated/)
})

test('demotes the root request to background scope', () => {
  const prompt = renderWorkPrompt({
    step_path: '2-draft',
    kind: 'agent',
    prompt: '# Task: Draft',
    context: { prompt: 'Write a launch post.' },
  })
  assert.match(prompt, /# Reference: original request/)
  assert.match(prompt, /Background scope only/)
  assert.match(prompt, /Do not restate this request/)
  assert.match(prompt, /Write a launch post\./)
  assert.doesNotMatch(prompt, /# Request\n/)
})

test('omits the root request when the step opts out', () => {
  const prompt = renderWorkPrompt({
    step_path: '4-deliver',
    kind: 'agent',
    prompt: '# Task: Deliver',
    request: false,
    context: { prompt: 'Write a launch post.' },
  })
  assert.doesNotMatch(prompt, /# Reference/)
  assert.doesNotMatch(prompt, /Write a launch post\./)
})

test('renders artifact paths and marks missing files', () => {
  const prompt = renderWorkPrompt({
    step_path: '4-review',
    kind: 'agent',
    prompt: '# Task: Review',
    context: {
      prompt: 'Add a toggle.',
      artifacts: [
        { label: 'spec', path: 'spec.md', exists: true },
        { label: 'docs', path: 'docs/README.md', exists: false },
      ],
    },
  })
  assert.match(prompt, /# Artifacts/)
  assert.match(prompt, /spec — `spec\.md`/)
  assert.match(prompt, /docs — `docs\/README\.md` \(missing\)/)
})

test('renders the previous attempt so a retry does not repeat the work', () => {
  const prompt = renderWorkPrompt({
    step_path: '3-fix',
    kind: 'agent',
    prompt: '# Task: Fix',
    retry: {
      attempt: 1,
      error: 'budget exhausted before the step finished',
      result: { rootCause: 'runtime.ts reserves after the await' },
    },
    context: {
      prompt: 'Fix the repeat notification.',
    },
  })
  assert.match(prompt, /# Previous attempt/)
  assert.match(prompt, /Attempt 1 ended before the step finished/)
  assert.match(prompt, /runtime\.ts reserves after the await/)
  assert.match(prompt, /Do not repeat the same investigation/)
})

test('omits the previous attempt on a first attempt', () => {
  const prompt = renderWorkPrompt({
    step_path: '1-fix',
    kind: 'agent',
    prompt: '# Task: Fix',
    context: { prompt: 'Fix it.' },
  })
  assert.doesNotMatch(prompt, /# Previous attempt/)
})

test('renders the failure a recovery step is handling', () => {
  const prompt = renderWorkPrompt({
    step_path: 'verify/on_failure/1-recover',
    kind: 'agent',
    prompt: '# Task: Recover',
    context: {
      prompt: 'Rebuild Clara.',
      failure: {
        step: 'verify',
        attempt: 2,
        error: 'lab is not answering its health endpoint',
        result: { ok: false, services: [{ name: 'lab', healthy: false }] },
      },
    },
  })
  assert.match(prompt, /# Failure being recovered/)
  assert.match(prompt, /verify failed on attempt 2/)
  assert.match(prompt, /lab is not answering its health endpoint/)
  assert.match(prompt, /Work only on recovery/)
})

test('omits the failure section when there is no failure context', () => {
  const prompt = renderWorkPrompt({
    step_path: '1-verify',
    kind: 'agent',
    prompt: '# Task: Verify',
    context: { prompt: 'Verify it.' },
  })
  assert.doesNotMatch(prompt, /# Failure being recovered/)
})

test('scopes a router to route and fail and constrains the route enum', () => {
  const tools: Record<string, unknown> = {
    read: {},
    shell: {},
    execute: {},
    search: {},
    [toolName('route')]: { input: { type: 'object' } },
    [toolName('fail')]: {},
    [toolName('complete')]: {},
  }
  scopeWorkerTools(tools, {
    kind: 'router',
    managed: true,
    routes: [{ when: 'content' }, { when: 'software-development' }],
  })
  assert.deepEqual(
    Object.keys(tools).sort(),
    ['execute', 'search', toolName('fail'), toolName('route')].sort()
  )
  const route = tools[toolName('route')] as {
    input: { properties: { route: { enum: string[] } } }
  }
  assert.deepEqual(route.input.properties.route.enum, ['content', 'software-development'])
})

test('scopes a task to its control tools but keeps repository tools', () => {
  const tools: Record<string, unknown> = {
    read: {},
    shell: {},
    execute: {},
    search: {},
    [toolName('start')]: {},
    [toolName('status')]: {},
    [toolName('complete')]: {},
    [toolName('fail')]: {},
    [toolName('spawn')]: {},
  }
  scopeWorkerTools(tools, { kind: 'agent', managed: true })
  assert.deepEqual(
    Object.keys(tools).sort(),
    [
      'read',
      'shell',
      'execute',
      'search',
      toolName('complete'),
      toolName('fail'),
      toolName('spawn'),
    ].sort()
  )
})

test('never deletes the Code Mode gateway when scoping a router', () => {
  const tools: Record<string, unknown> = {
    execute: {},
    search: {},
    read: {},
    [toolName('route')]: { input: { type: 'object' } },
    [toolName('fail')]: {},
  }
  scopeWorkerTools(tools, { kind: 'router', managed: true })
  assert.ok('execute' in tools)
  assert.ok('search' in tools)
  assert.ok(toolName('route') in tools)
  assert.ok(toolName('fail') in tools)
  assert.ok(!('read' in tools))
})

test('does not scope a fallback parent binding', () => {
  const tools: Record<string, unknown> = { read: {}, [toolName('status')]: {} }
  scopeWorkerTools(tools, { kind: 'agent', managed: false })
  assert.deepEqual(Object.keys(tools).sort(), ['read', toolName('status')].sort())
})
