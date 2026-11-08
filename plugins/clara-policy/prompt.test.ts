import assert from 'node:assert/strict'
import test from 'node:test'
import { renderWorkPrompt, scopeWorkerTools, toolName } from './prompt.ts'

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
    steps: [],
  },
}

test('renders the root request and the compiled router prompt once', () => {
  const prompt = renderWorkPrompt(routerWork)
  assert.match(prompt, /Add a dark mode toggle/)
  assert.equal(prompt.match(/`content`/g)?.length, 1)
  assert.match(prompt, /Call `clara_route`/)
  assert.doesNotMatch(prompt, /work_token/)
  assert.doesNotMatch(prompt, /model:/)
  assert.doesNotMatch(prompt, /enforcement:/)
  assert.doesNotMatch(prompt, /attempt:/)
  assert.doesNotMatch(prompt, /Clara work order/)
})

test('renders prior results and skips the current step', () => {
  const prompt = renderWorkPrompt({
    step_path: '2-draft',
    kind: 'task',
    prompt: '# Task: Draft\n\nWrite the draft from the approved brief.',
    context: {
      prompt: 'Write a launch post.',
      steps: [
        { path: '1-brief', name: 'brief', result: 'Audience: developers. Tone: direct.' },
        { path: '2-draft', name: 'draft', result: 'stale retry output' },
      ],
    },
  })
  assert.match(prompt, /# Prior results/)
  assert.match(prompt, /Audience: developers/)
  assert.doesNotMatch(prompt, /stale retry output/)
  assert.match(prompt, /call `clara_complete`/)
})

test('renders structured prior results as JSON', () => {
  const prompt = renderWorkPrompt({
    step_path: '2-verify',
    kind: 'task',
    prompt: '# Task: Verify',
    context: {
      prompt: 'Research the market.',
      steps: [{ path: '1-gather', name: 'gather', result: { sources: ['https://example.com'] } }],
    },
  })
  assert.match(prompt, /"sources"/)
  assert.match(prompt, /https:\/\/example\.com/)
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
  scopeWorkerTools(tools, { kind: 'task', managed: true })
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
  scopeWorkerTools(tools, { kind: 'task', managed: false })
  assert.deepEqual(Object.keys(tools).sort(), ['read', toolName('status')].sort())
})
