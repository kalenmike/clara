import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import webpush from 'web-push'
import {
  isValidVapidSubject,
  loadVapidDetails,
  readVapidSubject,
  saveVapidSubject,
  validateVapidSubject,
} from '../src/push/vapid.ts'

const tempDirs: string[] = []
const ENV_KEYS = [
  'CLARA_VAPID_PUBLIC_KEY',
  'CLARA_VAPID_PRIVATE_KEY',
  'CLARA_VAPID_SUBJECT',
] as const

let savedEnv: Record<string, string | undefined> = {}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-vapid-'))
  tempDirs.push(dir)
  return dir
}

function writeVapidFile(dir: string, details: object): void {
  writeFileSync(join(dir, 'vapid.json'), `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 })
}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadVapidDetails', () => {
  it('uses the local default subject instead of the pairing web URL', () => {
    const dir = tempDir()
    const details = loadVapidDetails(dir)

    expect(details.subject).toBe('https://clara.local')
    const saved = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))
    expect(saved.publicKey).toBeTypeOf('string')
    expect(saved.privateKey).toBeTypeOf('string')
    expect(saved.subject).toBeUndefined()
  })

  it('prefers CLARA_VAPID_SUBJECT and keeps a stored subject as the fallback', () => {
    const dir = tempDir()
    writeVapidFile(dir, { ...webpush.generateVAPIDKeys(), subject: 'https://stored.example' })
    process.env.CLARA_VAPID_SUBJECT = 'mailto:ops@example.com'

    const details = loadVapidDetails(dir)

    expect(details.subject).toBe('mailto:ops@example.com')
    const saved = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))
    expect(saved.subject).toBe('https://stored.example')
  })

  it('treats empty VAPID environment values as unset', () => {
    const dir = tempDir()
    process.env.CLARA_VAPID_PUBLIC_KEY = ''
    process.env.CLARA_VAPID_PRIVATE_KEY = ''
    process.env.CLARA_VAPID_SUBJECT = ''

    const details = loadVapidDetails(dir)

    expect(details.subject).toBe('https://clara.local')
  })

  it('replaces an invalid stored subject with the default', () => {
    const dir = tempDir()
    writeVapidFile(dir, { ...webpush.generateVAPIDKeys(), subject: 'http://127.0.0.1:8080' })

    const details = loadVapidDetails(dir)

    expect(details.subject).toBe('https://clara.local')
    const saved = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))
    expect(saved.subject).toBeUndefined()
  })

  it('keeps a valid stored subject', () => {
    const dir = tempDir()
    writeVapidFile(dir, { ...webpush.generateVAPIDKeys(), subject: 'mailto:ops@example.com' })

    expect(loadVapidDetails(dir).subject).toBe('mailto:ops@example.com')
  })
})

describe('VAPID contact storage', () => {
  it('reports the environment, file, or default source', () => {
    const dir = tempDir()
    expect(readVapidSubject(dir)).toEqual({ value: 'https://clara.local', source: 'default' })

    writeVapidFile(dir, { subject: 'mailto:ops@example.com' })
    expect(readVapidSubject(dir)).toEqual({ value: 'mailto:ops@example.com', source: 'file' })

    process.env.CLARA_VAPID_SUBJECT = 'https://env.example'
    expect(readVapidSubject(dir)).toEqual({ value: 'https://env.example', source: 'env' })
  })

  it('saves and clears the contact without touching the key pair', () => {
    const dir = tempDir()
    const keys = webpush.generateVAPIDKeys()
    writeVapidFile(dir, keys)

    saveVapidSubject(dir, 'mailto:ops@example.com')
    let saved = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))
    expect(saved).toMatchObject({ ...keys, subject: 'mailto:ops@example.com' })

    saveVapidSubject(dir, undefined)
    saved = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))
    expect(saved).toMatchObject(keys)
    expect(saved.subject).toBeUndefined()
  })

  it('accepts HTTPS URLs and mailto addresses only', () => {
    expect(() => validateVapidSubject('http://example.com')).toThrow(/HTTPS URL or a mailto/)
    expect(isValidVapidSubject('http://example.com')).toBe(false)
    expect(isValidVapidSubject('https://example.com')).toBe(true)
    expect(isValidVapidSubject('mailto:ops@example.com')).toBe(true)
  })
})
