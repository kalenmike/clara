import { describe, expect, it } from 'vitest'
import { readHostIdentity, type HostIdentityDeps } from '../src/host-identity.ts'

function deps(overrides: Partial<HostIdentityDeps> = {}): Partial<HostIdentityDeps> {
  return {
    hostname: () => 'build-box',
    platform: () => 'linux',
    arch: () => 'x64',
    exists: async () => false,
    read: async () => {
      throw new Error('ENOENT')
    },
    env: () => ({}),
    ...overrides,
  }
}

describe('readHostIdentity', () => {
  it('reports the hostname, platform, and architecture of a bare machine', async () => {
    await expect(readHostIdentity(deps())).resolves.toEqual({
      hostname: 'build-box',
      platform: 'linux',
      arch: 'x64',
    })
  })

  it('detects Docker from the container marker', async () => {
    const identity = await readHostIdentity(
      deps({
        hostname: () => '3f2a1b',
        exists: async (path) => path === '/.dockerenv',
      })
    )
    expect(identity).toEqual({
      hostname: '3f2a1b',
      platform: 'linux',
      arch: 'x64',
      container: { runtime: 'docker' },
    })
  })

  it('detects Podman and Kubernetes without a marker file', async () => {
    const podman = await readHostIdentity(
      deps({ exists: async (path) => path === '/run/.containerenv' })
    )
    expect(podman.container).toEqual({ runtime: 'podman' })

    const kubernetes = await readHostIdentity(
      deps({ env: () => ({ KUBERNETES_SERVICE_HOST: '10.0.0.1' }) })
    )
    expect(kubernetes.container).toEqual({ runtime: 'kubernetes' })
  })

  it('falls back to the cgroup path for an otherwise unmarked container', async () => {
    const identity = await readHostIdentity(
      deps({
        read: async (path) => (path === '/proc/self/cgroup' ? '0::/docker/0123456789abcdef\n' : ''),
      })
    )
    expect(identity.container).toEqual({ runtime: 'docker' })
  })

  it('accepts an explicit runtime hint', async () => {
    const identity = await readHostIdentity(
      deps({ env: () => ({ CLARA_ADAPTER_CONTAINER: 'podman' }) })
    )
    expect(identity.container).toEqual({ runtime: 'podman' })
  })

  it('strips control characters and bounds a hostile hostname', async () => {
    const identity = await readHostIdentity(
      deps({ hostname: () => `  bad\u0000host\n${'x'.repeat(400)}  ` })
    )
    expect(identity.hostname?.startsWith('badhost')).toBe(true)
    expect(identity.hostname?.length).toBe(253)
  })
})
