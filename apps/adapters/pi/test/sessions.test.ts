import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ClaraEvent } from '@clara/api-contract'
import type { PiConfig } from '../src/config.ts'
import { SessionIndex } from '../src/pi/indexer.ts'
import { PromptMap } from '../src/prompt-map.ts'
import { SessionService } from '../src/sessions.ts'

const fake = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clara-pi-sessions-'))
  const project = join(root, 'project')
  mkdirSync(project)
  const config: PiConfig = {
    piPath: fake,
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
  }
  const events: ClaraEvent[] = []
  const index = new SessionIndex(() => [join(root, 'sessions')])
  const service = new SessionService(
    config,
    index,
    new PromptMap(join(root, 'prompt-ids.json')),
    '0.1.0',
    (event) => events.push(event)
  )
  return { root, project, config, events, index, service }
}

describe('Pi session service', () => {
  it('creates Pi-native session files and lists them', async () => {
    const { root, project, service, index } = fixture()
    const created = await service.create({
      location: { directory: project },
      title: 'Design review',
    })
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.title).toBe('Design review')
    expect(created.location.directory).toBe(project)

    const files = (await import('node:fs')).readdirSync(join(root, 'sessions'))
    expect(files).toHaveLength(1)
    expect(files[0]!.endsWith(`_${created.id}.jsonl`)).toBe(true)
    expect(existsSync(join(root, 'sessions', files[0]!))).toBe(true)

    const list = await service.list({})
    expect(list.data.map((session) => session.id)).toEqual([created.id])

    const found = await service.get(created.id)
    expect(found.title).toBe('Design review')

    const messages = await service.messages(created.id, { order: 'asc' })
    expect(messages.data).toEqual([])

    index.clear()
  })

  it('renames by appending a Pi session_info entry', async () => {
    const { project, service } = fixture()
    const created = await service.create({ location: { directory: project }, title: 'Before' })
    await service.update(created.id, { title: 'Renamed' })
    const found = await service.get(created.id)
    expect(found.title).toBe('Renamed')
  })

  it('writes the configured default model for new sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-pi-defaults-'))
    const project = join(root, 'project')
    mkdirSync(project)
    const config: PiConfig = {
      piPath: fake,
      agentDir: join(root, 'agent'),
      sessionDir: join(root, 'sessions'),
      model: 'fake/fake-model',
      thinkingLevel: 'high',
    }
    const service = new SessionService(
      config,
      new SessionIndex(() => [join(root, 'sessions')]),
      new PromptMap(join(root, 'prompt-ids.json')),
      '0.1.0',
      () => {}
    )
    const created = await service.create({ location: { directory: project } })
    expect(created.model).toEqual({ id: 'fake-model', providerID: 'fake' })
  })

  it('deletes the session file', async () => {
    const { root, service } = fixture()
    const created = await service.create({ location: { directory: root } })
    await service.remove(created.id)
    expect((await service.list({})).data).toEqual([])
  })

  it('groups projects from session working directories', async () => {
    const { project, service } = fixture()
    await service.create({ location: { directory: project } })
    const projects = await service.projects(false)
    expect(projects.map((entry) => entry.canonical)).toContain(project)
  })
})
