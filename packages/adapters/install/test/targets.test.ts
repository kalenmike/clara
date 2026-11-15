import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listDockerTargets,
  listSshTargets,
  parseDockerPs,
  readSshHosts,
  type RunCommand,
} from '../src/index.ts'

const tempDirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-ssh-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SSH config targets', () => {
  it('reads exact Host entries and includes', () => {
    const home = tempHome()
    const ssh = join(home, '.ssh')
    mkdirSync(join(ssh, 'config.d'), { recursive: true })
    writeFileSync(
      join(ssh, 'config'),
      [
        'Host *',
        '  User root',
        '',
        'Host prod',
        '  HostName prod.example',
        '  User ubuntu',
        '  Port 2222',
        '',
        'Host wild*',
        '  HostName wild.example',
        '',
        'Host db',
        '  HostName db.example',
        '',
        'Include config.d/*',
        '',
        'Host prod',
        '  HostName ignored.example',
      ].join('\n')
    )
    writeFileSync(
      join(ssh, 'config.d', 'edge'),
      ['Host edge', '  HostName edge.example', '  User ec2-user'].join('\n')
    )

    expect(readSshHosts(home)).toEqual([
      { alias: 'db', hostname: 'db.example' },
      { alias: 'edge', hostname: 'edge.example', user: 'ec2-user' },
      { alias: 'prod', hostname: 'prod.example', user: 'ubuntu', port: 2222 },
    ])
  })

  it('reports whether ssh is available', async () => {
    const home = tempHome()
    const missing: RunCommand = async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    await expect(listSshTargets({ homeDir: home, run: missing })).resolves.toEqual({
      available: false,
      reason: 'SSH is not installed on this machine.',
      hosts: [],
    })

    const present: RunCommand = async () => ({ stdout: '', stderr: 'OpenSSH_9.0' })
    await expect(listSshTargets({ homeDir: home, run: present })).resolves.toEqual({
      available: true,
      hosts: [],
    })
  })
})

describe('Docker targets', () => {
  it('parses docker ps JSON lines and compose labels', () => {
    expect(
      parseDockerPs(
        [
          JSON.stringify({
            ID: 'abcdef0123456789',
            Names: 'clara-adapter-opencode',
            Image: 'clara/adapter-opencode:latest',
            State: 'running',
            Labels:
              'com.docker.compose.project=clara,com.docker.compose.service=adapter,other=value',
          }),
          JSON.stringify({
            ID: '1234567890abcdef',
            Names: 'opencode',
            Image: 'opencode:latest',
            State: 'running',
            Labels: '',
          }),
          'not json',
        ].join('\n')
      )
    ).toEqual([
      {
        id: 'abcdef012345',
        name: 'clara-adapter-opencode',
        image: 'clara/adapter-opencode:latest',
        state: 'running',
        project: 'clara',
        service: 'adapter',
      },
      {
        id: '1234567890ab',
        name: 'opencode',
        image: 'opencode:latest',
        state: 'running',
      },
    ])
  })

  it('reports a missing Docker daemon', async () => {
    const missing: RunCommand = async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    await expect(listDockerTargets({ run: missing })).resolves.toEqual({
      available: false,
      reason: 'Docker is not available on this machine.',
      containers: [],
    })
  })
})
