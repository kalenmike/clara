import type { PanelSnapshot } from '@clara/shared-types'

/** A fixed mask, so a hidden value never leaks its length. */
export const PEEK_MASK = '••••••'

const PEEK_STORAGE_KEY = 'clara.panel.peek'
const MIN_SECRET_LENGTH = 4

export type PeekPreference = 'masked' | 'shown'

/**
 * The panel starts masked so opening it during a screen share never shows a
 * path, room, fingerprint, or endpoint by accident. The choice lasts for the
 * tab; a new tab starts masked again.
 */
export function readPeekPreference(storage: Pick<Storage, 'getItem'> | undefined): PeekPreference {
  try {
    return storage?.getItem(PEEK_STORAGE_KEY) === 'shown' ? 'shown' : 'masked'
  } catch {
    return 'masked'
  }
}

export function writePeekPreference(
  storage: Pick<Storage, 'setItem'> | undefined,
  preference: PeekPreference
): void {
  try {
    storage?.setItem(PEEK_STORAGE_KEY, preference)
  } catch {
    // The panel still works when the browser blocks storage.
  }
}

/**
 * Hide every sensitive value the snapshot exposes, for either a structured
 * field or free text such as an activity message or an error.
 *
 * WebSocket URLs are masked first, then the exact values are replaced with the
 * same fixed mask. Exact values catch hosts that appear without a scheme, such
 * as `getaddrinfo ENOTFOUND relay.example.com`.
 */
export function maskText(text: string, secrets: readonly string[] = []): string {
  let output = text.replace(/\b(wss?):\/\/[^\s"'<>]+/gi, (match, scheme: string) => {
    const trailing = /[),.;:!?]+$/.exec(match)?.[0] ?? ''
    return `${scheme}://${PEEK_MASK}${trailing}`
  })

  for (const secret of sensitiveValues(secrets)) {
    if (output.includes(secret)) output = output.split(secret).join(PEEK_MASK)
  }
  return output
}

/**
 * Values that must not appear in free text. The panel masks the fields
 * themselves separately; this list also removes them from activity messages
 * and error notices.
 */
export function collectSecrets(snapshot: PanelSnapshot | undefined): string[] {
  if (!snapshot) return []

  const values: Array<string | undefined> = [
    snapshot.agent.configPath,
    snapshot.agent.configDir,
    snapshot.config.relayUrl.value ?? undefined,
    snapshot.config.relayRoom.value ?? undefined,
    snapshot.local.url,
    isLoopbackHost(snapshot.local.host) ? undefined : snapshot.local.host,
    `${snapshot.local.host}:${snapshot.local.port}`,
    snapshot.opencode.url,
    publicHostnameOf(snapshot.opencode.url),
    ...snapshot.harnesses.flatMap((harness) => [
      harness.baseUrl,
      publicHostnameOf(harness.baseUrl),
    ]),
    snapshot.relay.url,
    hostnameOf(snapshot.relay.url),
    snapshot.relay.room,
    ...snapshot.storage.map((entry) => entry.path),
    ...snapshot.clients.map((client) => client.sid),
    ...snapshot.devices.map((device) => device.id),
  ]

  return values.filter((value): value is string => Boolean(value))
}

function sensitiveValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length >= MIN_SECRET_LENGTH))].sort(
    (left, right) => right.length - left.length
  )
}

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).hostname || undefined
  } catch {
    return undefined
  }
}

function publicHostnameOf(value: string | undefined): string | undefined {
  const hostname = hostnameOf(value)
  return hostname && !isLoopbackHost(hostname) ? hostname : undefined
}

function isLoopbackHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '0:0:0:0:0:0:0:1' ||
    value.startsWith('127.')
  )
}
