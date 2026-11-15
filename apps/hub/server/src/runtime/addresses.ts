import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { LocalAccessMode, PanelLocalAddress } from '@clara/shared-types'

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

/** Docker bridge interfaces the host owns and containers can route to. */
export function isDockerBridgeInterface(name: string): boolean {
  return name === 'docker0' || name === 'docker_gwbridge' || name.startsWith('br-')
}

/**
 * The bridge addresses a local container can use to reach a host-process hub.
 * Docker Desktop keeps its bridge inside a VM, so it has no host interface and
 * returns nothing here.
 */
export function dockerBridgeAddresses(interfaces: InterfaceMap = networkInterfaces()): string[] {
  const hosts: string[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!isDockerBridgeInterface(name)) continue
    for (const entry of entries ?? []) {
      if (!isIpv4(entry) || entry.internal) continue
      hosts.push(entry.address)
    }
  }
  return uniqueHosts(hosts)
}

/**
 * Non-loopback IPv4 addresses a machine on the same network can dial. Docker,
 * virtual-machine, and link-local interfaces are deliberately excluded so the
 * panel does not suggest an address that only the host itself can reach.
 */
export function lanAddresses(interfaces: InterfaceMap = networkInterfaces()): string[] {
  const hosts: string[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    if (isIgnoredInterface(name)) continue
    for (const entry of entries ?? []) {
      if (!isIpv4(entry) || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      hosts.push(entry.address)
    }
  }
  return uniqueHosts(hosts)
}

/**
 * The listener addresses for one access mode. Loopback leads so a local desktop
 * keeps its connection when the hub also exposes itself to containers or the
 * network. A wildcard bind covers every other address and never needs extras.
 */
export function localBindHosts(
  access: LocalAccessMode,
  customHost?: string,
  docker = dockerBridgeAddresses()
): string[] {
  if (access === 'lan') return ['0.0.0.0']
  if (access === 'loopback') return ['127.0.0.1']
  if (access === 'docker') return uniqueHosts(['127.0.0.1', ...docker])
  const custom = customHost?.trim() ?? ''
  if (!custom) return ['127.0.0.1']
  if (isWildcardHost(custom)) return ['0.0.0.0']
  return uniqueHosts(['127.0.0.1', custom])
}

/**
 * The concrete, dialable addresses behind a set of bound hosts. A wildcard bind
 * exposes every candidate; a specific bind exposes only the matching host.
 */
export function buildLocalAddresses(input: {
  access: LocalAccessMode
  bindHosts: readonly string[]
  port: number
  docker?: readonly string[]
  lan?: readonly string[]
  customHost?: string
}): PanelLocalAddress[] {
  if (input.access === 'loopback') {
    return [address('loopback', '127.0.0.1', input.port)]
  }

  const bindHosts = new Set(input.bindHosts.map((host) => normalizeHost(host)))
  const wildcard = input.bindHosts.some(isWildcardHost)
  const addresses: PanelLocalAddress[] = []
  const seen = new Set<string>()

  const add = (scope: PanelLocalAddress['scope'], host: string) => {
    const normalized = normalizeHost(host)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    addresses.push(address(scope, normalized, input.port))
  }

  if (wildcard || bindHosts.has('127.0.0.1') || bindHosts.has('::1')) add('loopback', '127.0.0.1')

  const docker = wildcard
    ? (input.docker ?? [])
    : (input.docker ?? []).filter((host) => bindHosts.has(normalizeHost(host)))
  for (const host of docker) add('docker', host)

  const customHost = input.customHost?.trim()
  if (
    customHost &&
    !isWildcardHost(customHost) &&
    !isLoopbackHost(customHost) &&
    (wildcard || bindHosts.has(normalizeHost(customHost)))
  ) {
    add('lan', customHost)
  }

  const lan = wildcard
    ? (input.lan ?? [])
    : (input.lan ?? []).filter((host) => bindHosts.has(normalizeHost(host)))
  for (const host of lan) add('lan', host)

  return addresses
}

/** The first Docker-network address, used as the default container pairing. */
export function containerAddress(
  addresses: readonly PanelLocalAddress[]
): PanelLocalAddress | undefined {
  return addresses.find((entry) => entry.scope === 'docker')
}

export function formatHost(host: string): string {
  if (host.startsWith('[')) return host
  return host.includes(':') ? `[${host}]` : host
}

export function wsUrl(host: string, port: number): string {
  return `ws://${formatHost(host)}:${port}/ws`
}

export function isLoopbackHost(host: string): boolean {
  const value = normalizeHost(host)
  return value === '127.0.0.1' || value === '::1' || value === 'localhost'
}

export function isWildcardHost(host: string): boolean {
  return WILDCARD_HOSTS.has(normalizeHost(host))
}

function address(scope: PanelLocalAddress['scope'], host: string, port: number): PanelLocalAddress {
  return { scope, host, url: wsUrl(host, port) }
}

function isIpv4(entry: NetworkInterfaceInfo): boolean {
  return entry.family === 'IPv4' || (entry.family as unknown) === 4
}

function isIgnoredInterface(name: string): boolean {
  return (
    name === 'lo' ||
    name.startsWith('docker') ||
    name.startsWith('br-') ||
    name.startsWith('veth') ||
    name.startsWith('virbr') ||
    name.startsWith('vmnet') ||
    name.startsWith('vboxnet')
  )
}

function normalizeHost(host: string): string {
  return host.trim().replace(/^\[(.*)\]$/, '$1')
}

function uniqueHosts(hosts: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const host of hosts) {
    const value = normalizeHost(host)
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}
