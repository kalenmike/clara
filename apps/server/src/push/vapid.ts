import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import webpush from 'web-push'

export const DEFAULT_VAPID_SUBJECT = 'https://clara.local'

export type VapidSubjectSource = 'env' | 'file' | 'default'

export type VapidSubjectInfo = {
  value: string
  source: VapidSubjectSource
}

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
 * VAPID identifies this hub to every browser push service. Keep the
 * private key with the rest of the hub config; rotating it invalidates every
 * existing subscription.
 *
 * The subject is deliberately independent of the pairing Web URL: the pairing
 * link may be a plain-HTTP loopback address, while Web Push requires an HTTPS
 * URL or a mailto: address.
 */
export function loadVapidDetails(
  configDir: string,
  defaultSubject = DEFAULT_VAPID_SUBJECT
): VapidDetails {
  const path = join(configDir, 'vapid.json')
  const previous = readVapidFile(path)
  const envPublic = readEnv('CLARA_VAPID_PUBLIC_KEY')
  const envPrivate = readEnv('CLARA_VAPID_PRIVATE_KEY')
  const envSubject = readEnv('CLARA_VAPID_SUBJECT')

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

  const storedSubject = validStoredSubject(previous?.subject)
  const subject = normalizeVapidSubject(envSubject ?? storedSubject ?? defaultSubject)
  validateVapidSubject(subject)

  const details: VapidDetails = { publicKey, privateKey, subject }
  if (!envPublic || !envPrivate) {
    persistVapid(path, details, previous, storedSubject)
  }
  return details
}

/**
 * Read the effective VAPID contact without generating or rewriting keys. The
 * panel uses this to show the value and where it came from.
 */
export function readVapidSubject(
  configDir: string,
  defaultSubject = DEFAULT_VAPID_SUBJECT
): VapidSubjectInfo {
  const envSubject = readEnv('CLARA_VAPID_SUBJECT')
  if (envSubject !== undefined) return { value: normalizeVapidSubject(envSubject), source: 'env' }

  let previous: VapidFile | undefined
  try {
    previous = readVapidFile(join(configDir, 'vapid.json'))
  } catch {
    previous = undefined
  }
  const storedSubject = validStoredSubject(previous?.subject)
  if (storedSubject !== undefined) {
    return { value: normalizeVapidSubject(storedSubject), source: 'file' }
  }
  return { value: defaultSubject, source: 'default' }
}

/** Persist a panel-edited VAPID contact while keeping the stored key pair. */
export function saveVapidSubject(configDir: string, value: string | undefined): void {
  const path = join(configDir, 'vapid.json')
  const previous = readVapidFile(path) ?? {}
  const normalized = value?.trim()
  const next: VapidFile = { ...previous }

  if (normalized) {
    validateVapidSubject(normalized)
    next.subject = normalized
  } else {
    delete next.subject
  }

  if (
    previous.publicKey === next.publicKey &&
    previous.privateKey === next.privateKey &&
    previous.subject === next.subject
  ) {
    return
  }
  writeVapidFile(path, next)
}

export function normalizeVapidSubject(value: string): string {
  return value.trim()
}

export function validateVapidSubject(value: string): void {
  const subject = value.trim()
  if (!subject) throw new Error('The VAPID contact is required')

  if (subject.startsWith('mailto:')) {
    if (subject.length <= 'mailto:'.length) throw new Error('The VAPID contact email is empty')
    return
  }

  let url: URL
  try {
    url = new URL(subject)
  } catch {
    throw new Error('The VAPID contact must be an HTTPS URL or a mailto: address')
  }
  if (url.protocol !== 'https:') {
    throw new Error('The VAPID contact must be an HTTPS URL or a mailto: address')
  }
}

export function isValidVapidSubject(value: string): boolean {
  try {
    validateVapidSubject(value)
    return true
  } catch {
    return false
  }
}

function validStoredSubject(value: string | undefined): string | undefined {
  if (!value) return undefined
  return isValidVapidSubject(value) ? value : undefined
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

function persistVapid(
  path: string,
  details: VapidDetails,
  previous: VapidFile | undefined,
  storedSubject: string | undefined
): void {
  const next: VapidFile = {
    publicKey: details.publicKey,
    privateKey: details.privateKey,
    ...(storedSubject ? { subject: storedSubject } : {}),
  }
  if (
    previous?.publicKey === next.publicKey &&
    previous?.privateKey === next.privateKey &&
    previous?.subject === next.subject
  ) {
    return
  }
  writeVapidFile(path, next)
}

function writeVapidFile(path: string, details: VapidFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
