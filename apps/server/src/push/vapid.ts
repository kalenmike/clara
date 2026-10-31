import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import webpush from 'web-push'

export type VapidDetails = {
  publicKey: string
  privateKey: string
  subject: string
}

type VapidFile = {
  publicKey?: string
  privateKey?: string
  subject?: string
}

/**
 * VAPID identifies this home agent to every browser push service. Keep the
 * private key with the rest of the agent config; rotating it invalidates every
 * existing subscription.
 */
export function loadVapidDetails(configDir: string, defaultSubject: string): VapidDetails {
  const path = join(configDir, 'vapid.json')
  const previous = readVapidFile(path)
  const envPublic = process.env.CLARA_VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.CLARA_VAPID_PRIVATE_KEY?.trim()
  const envSubject = process.env.CLARA_VAPID_SUBJECT?.trim()

  if (envPublic !== undefined && envPrivate === undefined) {
    throw new Error('Set both CLARA_VAPID_PUBLIC_KEY and CLARA_VAPID_PRIVATE_KEY, or neither')
  }
  if (envPrivate !== undefined && envPublic === undefined) {
    throw new Error('Set both CLARA_VAPID_PUBLIC_KEY and CLARA_VAPID_PRIVATE_KEY, or neither')
  }

  let publicKey = envPublic ?? previous?.publicKey
  let privateKey = envPrivate ?? previous?.privateKey

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys()
    publicKey = generated.publicKey
    privateKey = generated.privateKey
  }

  const subject = normalizeSubject(envSubject || previous?.subject || defaultSubject)
  validateSubject(subject)

  const details: VapidDetails = { publicKey, privateKey, subject }
  if (!envPublic || !envPrivate) {
    persistVapid(path, details, previous)
  }
  return details
}

function readVapidFile(path: string): VapidFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    return {
      publicKey: typeof record.publicKey === 'string' ? record.publicKey : undefined,
      privateKey: typeof record.privateKey === 'string' ? record.privateKey : undefined,
      subject: typeof record.subject === 'string' ? record.subject : undefined,
    }
  } catch (cause) {
    throw new Error(`Could not read ${path}: ${errorMessage(cause)}`, { cause })
  }
}

function persistVapid(path: string, details: VapidDetails, previous: VapidFile | undefined): void {
  if (
    previous?.publicKey === details.publicKey &&
    previous?.privateKey === details.privateKey &&
    previous?.subject === details.subject
  ) {
    return
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

function normalizeSubject(value: string): string {
  const trimmed = value.trim()
  return trimmed || 'https://clara.local'
}

function validateSubject(value: string): void {
  if (value.startsWith('mailto:')) {
    if (value.length <= 'mailto:'.length) throw new Error('The VAPID subject email is empty')
    return
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('The VAPID subject must be an HTTPS URL or a mailto: address')
  }
  if (url.protocol !== 'https:') {
    throw new Error('The VAPID subject must be an HTTPS URL or a mailto: address')
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
