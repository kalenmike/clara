import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  JsonValue,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
} from '@opencode/client'
import { readSidePanelTab, saveSidePanelTab, type SidePanelTab } from '@/lib/storage'

/**
 * Feature 002 — keep the plan and todo list visible in the right sidebar.
 *
 * The panel is a layout concern, so these tests render the real `SidePanel`
 * tree to static markup and assert on the resulting element structure: what is
 * inside the panel, what is a descendant of what, and in which order. The git
 * and terminal views are replaced with markers because their data plumbing is
 * out of scope; the plan section itself is the real component.
 */

const mocks = vi.hoisted(() => ({
  send: { mutateAsync: vi.fn(), isPending: false },
  contextCalls: 0,
}))

vi.mock('@/hooks/use-side-panel-width', () => ({
  useSidePanelWidth: () => ({ width: 320, dragging: false, handleProps: {} }),
}))

vi.mock('@/components/layout/git-panel', () => ({
  GitPanel: () => <div data-testid="git-view">git view</div>,
}))

vi.mock('@/components/chat/pair-terminal', () => ({
  PairTerminal: () => <div data-testid="terminal-view">terminal view</div>,
}))

vi.mock('@/features/chat/use-session-context', () => ({
  useSessionContext: () => {
    mocks.contextCalls += 1
    return { data: [] }
  },
}))

vi.mock('@/features/catalog/use-catalog', () => ({
  useModels: () => ({ data: [] }),
}))

vi.mock('@/features/sessions/use-wording', () => ({
  useSessionWording: () => ({
    singular: 'session',
    lowerSingular: 'session',
    plural: 'sessions',
    setSingular: () => {},
    reset: () => {},
  }),
}))

vi.mock('@/features/chat/use-chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/use-chat')>()
  return { ...actual, useSendSynthetic: () => mocks.send }
})

import { SidePanel } from './side-panel'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function assistant(
  content: SessionMessageAssistant['content'],
  created = 1
): SessionMessageAssistant {
  return {
    id: `msg-${created}`,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function todoCall(
  todos: JsonValue[],
  status: 'completed' | 'running' = 'completed'
): SessionMessageAssistant['content'][number] {
  return {
    type: 'tool',
    id: 'todo',
    name: 'todowrite',
    time: { created: 1 },
    state:
      status === 'completed'
        ? { status, input: { todos }, content: [{ type: 'text', text: 'ok' }] }
        : { status, input: { todos }, metadata: {} },
  }
}

function todoMessages(
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }[],
  created = 2
): SessionMessageInfo[] {
  return [assistant([todoCall(todos as unknown as JsonValue[])], created)]
}

function makeSession(id = 'ses_a'): SessionInfo {
  return {
    id,
    title: `title ${id}`,
    time: { created: 1_000, updated: 2_000 },
    location: { directory: '/repo' },
  } as unknown as SessionInfo
}

// ---------------------------------------------------------------------------
// Minimal markup reader
//
// `renderToStaticMarkup` gives the same element nesting and document order the
// browser would get, so a small tag-stack parser is enough to ask "is this
// section inside that scroll container" without a DOM implementation.
// ---------------------------------------------------------------------------

type El = {
  tag: string
  attrs: Record<string, string>
  children: El[]
  parent?: El
  order: number
  text: string
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

function decode(value: string): string {
  return value.replace(
    /&(?:amp|quot|#x27|#39|lt|gt|nbsp);/g,
    (entity) => ENTITIES[entity] ?? entity
  )
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([^\s=/>]+)(?:="([^"]*)")?/g
  for (const match of source.matchAll(pattern)) {
    attrs[match[1]] = decode(match[2] ?? '')
  }
  return attrs
}

function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], order: 0, text: '' }
  const stack: El[] = [root]
  let index = 0
  let order = 0

  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open === -1) {
      stack[stack.length - 1].text += decode(html.slice(index))
      break
    }
    if (open > index) stack[stack.length - 1].text += decode(html.slice(index, open))

    let cursor = open + 1
    let quote: string | undefined
    for (; cursor < html.length; cursor += 1) {
      const char = html[cursor]
      if (quote) {
        if (char === quote) quote = undefined
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === '>') break
    }

    const raw = html.slice(open + 1, cursor)
    index = cursor + 1
    if (raw.startsWith('!') || raw.startsWith('?')) continue

    const closing = raw.startsWith('/')
    const body = closing ? raw.slice(1) : raw
    const selfClosing = body.endsWith('/')
    const source = selfClosing ? body.slice(0, -1) : body
    const name = /^[a-zA-Z][^\s/>]*/.exec(source)
    if (!name) continue
    const tag = name[0].toLowerCase()

    if (closing) {
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tag === tag) {
          stack.length = depth
          break
        }
      }
      continue
    }

    const el: El = {
      tag,
      attrs: parseAttrs(source.slice(name[0].length)),
      children: [],
      parent: stack[stack.length - 1],
      order: (order += 1),
      text: '',
    }
    stack[stack.length - 1].children.push(el)
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(el)
  }

  return root
}

function find(root: El, predicate: (el: El) => boolean): El[] {
  const found: El[] = []
  const visit = (el: El) => {
    if (predicate(el)) found.push(el)
    for (const child of el.children) visit(child)
  }
  visit(root)
  return found
}

function classes(el: El): string[] {
  return (el.attrs.class ?? '').split(/\s+/).filter(Boolean)
}

function textOf(el: El): string {
  return el.text + el.children.map(textOf).join('')
}

function ancestors(el: El): El[] {
  const chain: El[] = []
  for (let current = el.parent; current && current.tag !== '#root'; current = current.parent) {
    chain.push(current)
  }
  return chain
}

function contains(ancestor: El, el: El): boolean {
  for (let current = el.parent; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function serialize(el: El): string {
  const attrs = Object.entries(el.attrs)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return `<${el.tag}${attrs}>${el.text}${el.children.map(serialize).join('')}</${el.tag}>`
}

function closest(el: El, predicate: (el: El) => boolean): El | undefined {
  for (let current: El | undefined = el; current; current = current.parent) {
    if (predicate(current)) return current
  }
  return undefined
}

const SCROLLS_VERTICALLY = [
  'overflow-y-auto',
  'overflow-y-scroll',
  'overflow-auto',
  'overflow-scroll',
]

function scrollsVertically(el: El): boolean {
  const tokens = classes(el)
  return SCROLLS_VERTICALLY.some((token) => tokens.includes(token))
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

type PanelOptions = {
  tab: SidePanelTab
  messages?: SessionMessageInfo[]
  session?: SessionInfo
  draft?: boolean
  resizable?: boolean
  className?: string
  onClose?: () => void
}

function renderPanel({
  tab,
  messages = [],
  session = makeSession(),
  draft = false,
  resizable = true,
  className,
  onClose,
}: PanelOptions): El {
  const html = renderToStaticMarkup(
    <SidePanel
      session={session}
      snapshot={{
        messages,
        status: { type: 'idle' },
        cost: 0,
        revision: 1,
        historyRevision: 0,
        hasOlder: false,
      }}
      messages={messages}
      directory="/repo"
      projectID="proj"
      canonical="/repo"
      draft={draft}
      tab={tab}
      onTabChange={() => {}}
      resizable={resizable}
      className={className}
      onClose={onClose}
    />
  )
  return parseHtml(html)
}

function asideOf(root: El): El {
  const aside = find(root, (el) => el.tag === 'aside')
  expect(aside).toHaveLength(1)
  return aside[0]
}

function planSections(root: El): El[] {
  return find(root, (el) => el.tag === 'section' && el.attrs['aria-label'] === 'Plan')
}

function singlePlan(root: El): El {
  const plans = planSections(root)
  expect(plans, 'exactly one Plan & todo section').toHaveLength(1)
  return plans[0]
}

function view(root: El, testID: string): El {
  const markers = find(root, (el) => el.attrs['data-testid'] === testID)
  expect(markers, `the ${testID} marker`).toHaveLength(1)
  return markers[0]
}

function insideTabPanel(el: El): boolean {
  return ancestors(el).some((ancestor) => ancestor.attrs.role === 'tabpanel')
}

function activeTabPanel(root: El): El {
  const panels = find(
    root,
    (el) => el.attrs.role === 'tabpanel' && el.attrs['data-state'] === 'active'
  )
  expect(panels, 'one active tab content').toHaveLength(1)
  return panels[0]
}

function assertPlanBelowAndDetached(root: El, marker: El) {
  const plan = singlePlan(root)
  expect(plan.order, 'plan follows the tab content').toBeGreaterThan(marker.order)
  expect(insideTabPanel(plan), 'plan is not inside the tab content panel').toBe(false)

  // The view scrolls inside its own container; the plan must not be inside it,
  // otherwise it scrolls away with the diff or the terminal log.
  let scrollArea: El | undefined
  for (const ancestor of ancestors(marker)) {
    if (!scrollsVertically(ancestor)) continue
    scrollArea = ancestor
    expect(contains(ancestor, plan), 'plan stays outside the scrolling view').toBe(false)
  }
  expect(scrollArea, 'the view keeps its own scroll area').toBeDefined()
  return plan
}

// ---------------------------------------------------------------------------
// Tests — one per approved acceptance criterion (1–11). Criterion 12 maps to
// the existing `features/chat/session-plan.test.ts` regression suite; see the
// test report.
// ---------------------------------------------------------------------------

beforeEach(() => {
  mocks.send.mutateAsync.mockReset()
  mocks.send.isPending = false
  mocks.contextCalls = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('side panel plan visibility', () => {
  it('1. renders the plan inside the panel below the Info tab content, within the panel bounds', () => {
    const root = renderPanel({
      tab: 'info',
      messages: todoMessages([{ content: 'Read the ledger', status: 'in_progress' }]),
    })

    const aside = asideOf(root)
    const infoPanel = activeTabPanel(root)
    expect(textOf(infoPanel), 'the Info tab content renders').toContain('Context')

    const plan = singlePlan(root)
    expect(contains(aside, plan), 'plan lives inside the panel').toBe(true)
    expect(contains(aside, infoPanel), 'the Info content stays inside the panel').toBe(true)
    expect(insideTabPanel(plan), 'plan is below the Info tab content, not inside it').toBe(false)
    expect(plan.order, 'plan follows the Info content').toBeGreaterThan(infoPanel.order)

    // Both stay inside the panel: the plan is not absolutely positioned out of
    // it and does not opt out of the panel's clip.
    for (const ancestor of ancestors(plan)) {
      expect(classes(ancestor)).not.toContain('fixed')
      expect(classes(ancestor)).not.toContain('w-screen')
    }
    expect(classes(aside)).toContain('overflow-hidden')
  })

  it('2. renders the plan below the Git view, outside its scroll area, on the Git tab', () => {
    const root = renderPanel({
      tab: 'git',
      messages: todoMessages([{ content: 'Ship the panel', status: 'pending' }]),
    })

    const plan = assertPlanBelowAndDetached(root, view(root, 'git-view'))
    expect(textOf(plan)).toContain('Ship the panel')
  })

  it('3. renders the plan below the Terminal view, outside its scroll area, on the Terminal tab', () => {
    const root = renderPanel({
      tab: 'terminal',
      messages: todoMessages([{ content: 'Watch the build', status: 'completed' }]),
    })

    const plan = assertPlanBelowAndDetached(root, view(root, 'terminal-view'))
    expect(textOf(plan)).toContain('Watch the build')
  })

  it('4. keeps the plan mounted in the same position and never hidden across tab switches', () => {
    const messages = todoMessages([{ content: 'Stay visible', status: 'in_progress' }])
    const renders = (['info', 'git', 'terminal'] as const).map((tab) =>
      renderPanel({ tab, messages })
    )

    const markup = renders.map((root) => serialize(singlePlan(root)))
    expect(new Set(markup).size, 'the plan markup is identical on every tab').toBe(1)

    const chains = renders.map((root) => {
      const plan = singlePlan(root)
      return ancestors(plan)
        .slice()
        .reverse()
        .map((ancestor) => ancestor.tag)
        .join('>')
    })
    expect(new Set(chains).size, 'the plan keeps the same position in the panel').toBe(1)

    for (const root of renders) {
      const plan = singlePlan(root)
      expect(plan.attrs.hidden).toBeUndefined()
      expect(plan.attrs.inert).toBeUndefined()
      expect(plan.attrs['aria-hidden']).not.toBe('true')
      expect(classes(plan)).not.toContain('hidden')
      const visiblePanel = activeTabPanel(root)
      expect(plan.order, 'plan stays below the active tab content').toBeGreaterThan(
        visiblePanel.order
      )
    }
  })

  it('5. has exactly one plan section: no tab renders its own copy', () => {
    const messages = todoMessages([{ content: 'Only once', status: 'pending' }])

    for (const tab of ['info', 'git', 'terminal'] as const) {
      const root = renderPanel({ tab, messages })
      const plans = planSections(root)
      expect(plans, `one plan section on the ${tab} tab`).toHaveLength(1)
      expect(insideTabPanel(plans[0]), `no copy inside the ${tab} tab content`).toBe(false)
      for (const panel of find(root, (el) => el.attrs.role === 'tabpanel')) {
        expect(planSections(panel), 'tab panels never contain a plan copy').toHaveLength(0)
      }
    }
  })

  it('6. keeps the plan content and actions unchanged after relocation', () => {
    const root = renderPanel({
      tab: 'git',
      messages: todoMessages([
        { content: 'First step', status: 'completed' },
        { content: 'Second step', status: 'pending' },
      ]),
    })

    const plan = singlePlan(root)
    const text = textOf(plan)
    expect(text).toContain('First step')
    expect(text).toContain('Second step')
    expect(text, 'completed/total progress').toContain('1/2')
    expect(text, 'the update action').toContain('Request Update')
    expect(text).not.toContain('Request Plan')

    const empty = singlePlan(renderPanel({ tab: 'git', messages: [] }))
    expect(textOf(empty)).toContain('No plan yet.')
    expect(textOf(empty)).toContain('Request Plan')
    expect(textOf(empty)).not.toContain('Request Update')

    const draft = singlePlan(renderPanel({ tab: 'git', messages: [], draft: true }))
    expect(textOf(draft)).toContain('Send your session to view the plan.')
    expect(textOf(draft)).not.toContain('Request Plan')
    expect(textOf(draft)).not.toContain('Request Update')
  })

  it('7. updates the visible checklist while the Git tab is active without switching tabs', () => {
    const before = renderPanel({
      tab: 'git',
      messages: todoMessages([
        { content: 'Write the tests', status: 'in_progress' },
        { content: 'Freeze the suite', status: 'pending' },
      ]),
    })
    expect(textOf(singlePlan(before))).toContain('Write the tests')
    expect(textOf(singlePlan(before))).toContain('0/2')

    const after = renderPanel({
      tab: 'git',
      messages: todoMessages([
        { content: 'Write the tests', status: 'completed' },
        { content: 'Freeze the suite', status: 'completed' },
      ]),
    })
    const text = textOf(singlePlan(after))
    expect(text, 'the completed checklist is visible on the Git tab').toContain('Freeze the suite')
    expect(text, 'progress reflects the new todowrite').toContain('2/2')
  })

  it('8. replaces the plan when the session changes on the Git tab', () => {
    const first = renderPanel({
      tab: 'git',
      session: makeSession('ses_a'),
      messages: todoMessages([{ content: 'Session A task', status: 'in_progress' }]),
    })
    expect(textOf(singlePlan(first))).toContain('Session A task')

    const second = renderPanel({
      tab: 'git',
      session: makeSession('ses_b'),
      messages: [],
    })
    const emptyText = textOf(singlePlan(second))
    expect(emptyText).toContain('No plan yet.')
    expect(emptyText, "the previous session's checklist is gone").not.toContain('Session A task')

    const third = renderPanel({
      tab: 'git',
      session: makeSession('ses_c'),
      messages: todoMessages([{ content: 'Session C task', status: 'pending' }]),
    })
    const thirdText = textOf(singlePlan(third))
    expect(thirdText).toContain('Session C task')
    expect(thirdText).not.toContain('Session A task')
  })

  it('9. keeps the plan below the tab content on a narrow full-width sheet, without clipping', () => {
    const messages = todoMessages([{ content: 'Narrow screen task', status: 'pending' }])

    for (const tab of ['info', 'git', 'terminal'] as const) {
      const root = renderPanel({
        tab,
        messages,
        resizable: false,
        className: 'w-full',
        onClose: () => {},
      })
      const aside = asideOf(root)
      expect(classes(aside), 'the sheet spans the viewport').toContain('w-full')
      expect(aside.attrs.style, 'the sheet is not pinned to the desktop width').toBeUndefined()
      expect(
        find(root, (el) => el.tag === 'button' && el.attrs.title === 'Close panel'),
        'the sheet keeps its close control'
      ).toHaveLength(1)

      const plan = singlePlan(root)
      expect(contains(aside, plan), 'plan stays in the sheet').toBe(true)
      expect(insideTabPanel(plan), `plan is below the ${tab} content`).toBe(false)

      for (const ancestor of ancestors(plan)) {
        const tokens = classes(ancestor)
        expect(tokens, 'no horizontal clipping').not.toContain('overflow-x-hidden')
        expect(tokens, 'no horizontal clipping').not.toContain('w-screen')
        expect(tokens, 'plan text is not forced onto one line').not.toContain('whitespace-nowrap')
        if (ancestor === aside) continue
        // Anything that clips vertically between the plan and the panel must
        // also scroll, or the plan would be unreachable on a phone.
        if (tokens.includes('overflow-hidden')) {
          expect(scrollsVertically(ancestor) || tokens.includes('overflow-y-auto')).toBe(true)
        }
      }
    }
  })

  it('10. restores Git or Terminal on reload and still shows the plan below it', () => {
    const storage = fakeStorage()
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage })

    saveSidePanelTab('git')
    expect(readSidePanelTab()).toBe('git')
    const gitRoot = renderPanel({
      tab: readSidePanelTab(),
      messages: todoMessages([{ content: 'Persisted task', status: 'pending' }]),
    })
    assertPlanBelowAndDetached(gitRoot, view(gitRoot, 'git-view'))

    saveSidePanelTab('terminal')
    expect(readSidePanelTab()).toBe('terminal')
    const terminalRoot = renderPanel({
      tab: readSidePanelTab(),
      messages: todoMessages([{ content: 'Persisted task', status: 'pending' }]),
    })
    assertPlanBelowAndDetached(terminalRoot, view(terminalRoot, 'terminal-view'))

    // Resize, close, and open behavior are untouched by the relocation.
    const desktop = renderPanel({ tab: 'git', messages: [] })
    const handle = find(desktop, (el) => el.attrs.role === 'separator')
    expect(handle, 'the desktop resize handle is still renderable').toHaveLength(1)
    expect(handle[0].attrs['aria-valuenow']).toBe('320')
    expect(
      find(desktop, (el) => el.tag === 'button' && el.attrs.title === 'Close panel'),
      'no in-panel close control unless the panel is a sheet'
    ).toHaveLength(0)

    const sheet = renderPanel({ tab: 'git', messages: [], resizable: false, onClose: () => {} })
    expect(
      find(sheet, (el) => el.attrs.role === 'separator'),
      'no handle on the sheet'
    ).toHaveLength(0)
    expect(
      find(sheet, (el) => el.tag === 'button' && el.attrs.title === 'Close panel'),
      'the sheet can still close'
    ).toHaveLength(1)
  })

  it('11. issues no new plan, todo, or message request when switching tabs', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const messages = todoMessages([{ content: 'Already loaded', status: 'in_progress' }])

    mocks.contextCalls = 0
    const info = renderPanel({ tab: 'info', messages })
    const infoCalls = mocks.contextCalls

    mocks.contextCalls = 0
    const git = renderPanel({ tab: 'git', messages })
    const gitCalls = mocks.contextCalls

    mocks.contextCalls = 0
    const terminal = renderPanel({ tab: 'terminal', messages })
    const terminalCalls = mocks.contextCalls

    expect(mocks.send.mutateAsync, 'no plan request is sent').not.toHaveBeenCalled()
    expect(fetchSpy, 'no fetch is issued').not.toHaveBeenCalled()
    expect(gitCalls, 'the Git tab adds no plan query').toBeLessThanOrEqual(infoCalls)
    expect(terminalCalls, 'the Terminal tab adds no plan query').toBeLessThanOrEqual(infoCalls)

    // The section reads the transcript the chat already loaded.
    for (const root of [git, terminal]) {
      expect(textOf(singlePlan(root))).toContain('Already loaded')
    }
  })
})

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}
