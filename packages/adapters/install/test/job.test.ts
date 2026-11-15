import { describe, expect, it } from 'vitest'
import { InstallJobService, type InstallRunner } from '../src/index.ts'

async function settled(service: InstallJobService, id: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = service.job(id)
    if (job && job.state !== 'running') return job
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return service.job(id)
}

describe('InstallJobService', () => {
  it('streams lines and records success', async () => {
    const runner: InstallRunner = async (_command, _args, onLine) => {
      onLine('downloading')
      onLine('installed')
      return { exitCode: 0 }
    }
    const service = new InstallJobService({ runner })
    const started = service.start({
      kind: 'claude',
      method: 'local',
      target: 'this machine',
      command: 'sh',
      args: ['-c', 'true'],
    })
    expect(started.state).toBe('running')
    const job = await settled(service, started.id)
    expect(job?.state).toBe('succeeded')
    expect(job?.lines).toContain('downloading')
    expect(job?.lines).toContain('installed')
  })

  it('records a failed exit code', async () => {
    const runner: InstallRunner = async () => ({ exitCode: 1 })
    const service = new InstallJobService({ runner })
    const started = service.start({
      kind: 'opencode',
      method: 'ssh',
      target: 'prod',
      command: 'ssh',
      args: [],
    })
    const job = await settled(service, started.id)
    expect(job?.state).toBe('failed')
    expect(job?.error).toContain('exited with 1')
  })
})
