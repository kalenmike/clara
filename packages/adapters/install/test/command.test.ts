import { describe, expect, it } from 'vitest'
import type { PanelInstallManifest } from '@clara/shared-types'
import {
  buildInstallPlan,
  buildInstallScript,
  adapterRegistryBase,
  dockerInvocation,
  sshInvocation,
  validateDockerTarget,
  validateOpencodeUrl,
  validateSshTarget,
} from '../src/index.ts'

const manifest: PanelInstallManifest = {
  schemaVersion: 1,
  harness: 'opencode',
  version: '0.1.0-dev+abc1234',
  install: 'https://clara.example/adapters/opencode/install.sh',
  installSha256: 'a'.repeat(64),
  artifacts: {},
}

describe('install command helpers', () => {
  it('validates SSH aliases and manual targets', () => {
    expect(validateSshTarget({ alias: 'prod' })).toEqual({
      destination: 'prod',
      label: 'prod',
      alias: 'prod',
    })
    expect(validateSshTarget({ hostname: 'server.example', user: 'ubuntu', port: 2222 })).toEqual({
      destination: 'ubuntu@server.example',
      label: 'ubuntu@server.example',
      port: 2222,
    })
    expect(validateSshTarget({ hostname: '2001:db8::1' })).toEqual({
      destination: '[2001:db8::1]',
      label: '[2001:db8::1]',
    })
  })

  it('rejects option injection and invalid targets', () => {
    expect(() => validateSshTarget({ hostname: '-oProxyCommand=sh' })).toThrow()
    expect(() => validateSshTarget({ hostname: 'server', user: '-u' })).toThrow()
    expect(() => validateSshTarget({ hostname: 'server', port: 0 })).toThrow()
    expect(() => validateDockerTarget('--help')).toThrow()
    expect(validateDockerTarget('clara-adapter-opencode')).toEqual({
      container: 'clara-adapter-opencode',
      label: 'clara-adapter-opencode',
    })
  })

  it('normalizes OpenCode URLs and rejects credentials or queries', () => {
    expect(validateOpencodeUrl('http://127.0.0.1:4096/')).toBe('http://127.0.0.1:4096')
    expect(() => validateOpencodeUrl('http://user:pass@opencode:4096')).toThrow()
    expect(() => validateOpencodeUrl('http://opencode:4096?x=1')).toThrow()
    expect(() => validateOpencodeUrl('file:///tmp/opencode')).toThrow()
  })

  it('builds a verified install script with the pairing code', () => {
    const script = buildInstallScript({
      kind: 'opencode',
      manifest,
      installUrl: manifest.install,
      pairingCode: 'clara-harness1_code',
      opencodeUrl: 'http://127.0.0.1:4096',
    })
    expect(script).toContain('mktemp')
    expect(script).toContain('--proto "=https"')
    expect(script).toContain(`expected='${'a'.repeat(64)}'`)
    expect(script).toContain(`'--pair' 'clara-harness1_code'`)
    expect(script).not.toContain("'--no-runner'")
    expect(script).toContain("'--opencode-url' 'http://127.0.0.1:4096'")
    expect(script).toContain("CLARA_ADAPTER_REGISTRY_URL='https://clara.example/adapters'")
    expect(script).toContain('checksum did not match')
  })

  it('derives the registry base from the installer URL', () => {
    expect(adapterRegistryBase('https://clara.example/adapters/opencode/v1-install.sh')).toBe(
      'https://clara.example/adapters'
    )
    expect(adapterRegistryBase('not a url')).toBeUndefined()
  })

  it('starts the adapter and waits for an authenticated hub link', () => {
    const script = buildInstallScript({
      kind: 'claude',
      manifest: { ...manifest, harness: 'claude', version: '1.2.3' },
      installUrl: manifest.install,
      pairingCode: 'code',
    })
    expect(script).toContain("version='1.2.3'")
    expect(script).toContain('"$binary" start')
    expect(script).toContain('"status":[[:space:]]*"authenticated"')
    expect(script).toContain('[[:space:]]*$pid([^0-9]|$)')
    expect(script).toContain('The adapter was installed but did not start or connect.')
    expect(script).toContain('tail -n 80 "$data/adapter.log"')
  })

  it('does not pass --no-runner to the Claude adapter', () => {
    const script = buildInstallScript({
      kind: 'claude',
      manifest: { ...manifest, harness: 'claude' },
      installUrl: manifest.install,
      pairingCode: 'code',
    })
    expect(script).not.toContain('--no-runner')
  })

  it('quotes the remote script and builds ssh/docker argv', () => {
    const script = 'sh "$tmp" --pair \'code\''
    expect(sshInvocation({ destination: 'prod', label: 'prod', port: 2222 }, script)).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=10',
      '-p',
      '2222',
      'prod',
      script,
    ])
    expect(dockerInvocation({ container: 'harness', label: 'harness' }, script)).toEqual([
      'exec',
      'harness',
      'sh',
      '-lc',
      script,
    ])
  })

  it('plans local, SSH, and Docker installs from the same script', () => {
    const local = buildInstallPlan({
      kind: 'claude',
      method: 'local',
      manifest: { ...manifest, harness: 'claude' },
      pairingCode: 'code',
    })
    expect(local.command).toBe('sh')
    expect(local.args).toEqual(['-c', local.script])
    expect(local.target).toBe('this machine')

    const ssh = buildInstallPlan({
      kind: 'claude',
      method: 'ssh',
      manifest: { ...manifest, harness: 'claude' },
      pairingCode: 'code',
      host: { alias: 'prod' },
    })
    expect(ssh.command).toBe('ssh')
    expect(ssh.args.at(-2)).toBe('prod')

    const docker = buildInstallPlan({
      kind: 'claude',
      method: 'docker',
      manifest: { ...manifest, harness: 'claude' },
      pairingCode: 'code',
      container: 'harness',
    })
    expect(docker.command).toBe('docker')
    expect(docker.args.slice(0, 3)).toEqual(['exec', 'harness', 'sh'])
  })
})
