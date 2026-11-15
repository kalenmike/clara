import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  buildLocalAddresses,
  containerAddress,
  dockerBridgeAddresses,
  lanAddresses,
  localBindHosts,
} from '../src/runtime/addresses.ts'

function entry(
  address: string,
  overrides: Partial<NetworkInterfaceInfo> = {}
): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
    ...overrides,
  } as NetworkInterfaceInfo
}

describe('dockerBridgeAddresses', () => {
  it('returns IPv4 addresses on Docker bridge interfaces only', () => {
    expect(
      dockerBridgeAddresses({
        docker0: [entry('172.17.0.1')],
        'br-abc123': [entry('172.18.0.1')],
        eth0: [entry('192.168.1.20')],
        lo: [entry('127.0.0.1', { internal: true })],
      })
    ).toEqual(['172.17.0.1', '172.18.0.1'])
  })

  it('ignores internal and IPv6 addresses', () => {
    expect(
      dockerBridgeAddresses({
        docker0: [
          entry('172.17.0.1', { internal: true }),
          entry('fe80::1', { family: 'IPv6', internal: false }),
        ],
      })
    ).toEqual([])
  })
})

describe('lanAddresses', () => {
  it('returns routable IPv4 addresses without Docker or virtual interfaces', () => {
    expect(
      lanAddresses({
        eth0: [entry('192.168.1.20')],
        wlan0: [entry('10.0.0.5')],
        docker0: [entry('172.17.0.1')],
        veth1234: [entry('172.18.0.2')],
        lo: [entry('127.0.0.1', { internal: true })],
      })
    ).toEqual(['192.168.1.20', '10.0.0.5'])
  })
})

describe('localBindHosts', () => {
  it('maps each access mode to its listener addresses', () => {
    expect(localBindHosts('loopback', undefined, ['172.17.0.1'])).toEqual(['127.0.0.1'])
    expect(localBindHosts('docker', undefined, ['172.17.0.1'])).toEqual(['127.0.0.1', '172.17.0.1'])
    expect(localBindHosts('lan', undefined, ['172.17.0.1'])).toEqual(['0.0.0.0'])
    expect(localBindHosts('custom', '192.168.1.20', ['172.17.0.1'])).toEqual([
      '127.0.0.1',
      '192.168.1.20',
    ])
    expect(localBindHosts('custom', '0.0.0.0', ['172.17.0.1'])).toEqual(['0.0.0.0'])
  })
})

describe('buildLocalAddresses', () => {
  it('reports loopback for a loopback-only hub', () => {
    expect(
      buildLocalAddresses({
        access: 'loopback',
        bindHosts: ['127.0.0.1'],
        port: 8788,
      })
    ).toEqual([{ scope: 'loopback', host: '127.0.0.1', url: 'ws://127.0.0.1:8788/ws' }])
  })

  it('reports Docker and LAN addresses from the bound hosts', () => {
    const addresses = buildLocalAddresses({
      access: 'docker',
      bindHosts: ['127.0.0.1', '172.17.0.1'],
      port: 8788,
      docker: ['172.17.0.1'],
      lan: ['192.168.1.20'],
    })
    expect(addresses).toEqual([
      { scope: 'loopback', host: '127.0.0.1', url: 'ws://127.0.0.1:8788/ws' },
      { scope: 'docker', host: '172.17.0.1', url: 'ws://172.17.0.1:8788/ws' },
    ])
    expect(containerAddress(addresses)?.url).toBe('ws://172.17.0.1:8788/ws')
  })

  it('reports every candidate for a wildcard bind', () => {
    const addresses = buildLocalAddresses({
      access: 'lan',
      bindHosts: ['0.0.0.0'],
      port: 8788,
      docker: ['172.17.0.1'],
      lan: ['192.168.1.20'],
    })
    expect(addresses.map((entry) => entry.scope)).toEqual(['loopback', 'docker', 'lan'])
  })

  it('includes a custom address even when it is not a detected interface', () => {
    const addresses = buildLocalAddresses({
      access: 'custom',
      bindHosts: ['127.0.0.1', '10.20.30.40'],
      port: 8788,
      customHost: '10.20.30.40',
    })
    expect(addresses).toContainEqual({
      scope: 'lan',
      host: '10.20.30.40',
      url: 'ws://10.20.30.40:8788/ws',
    })
  })
})
