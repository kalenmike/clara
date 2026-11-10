import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 32_768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_BYTES = 64
const SALT_BYTES = 16
const TOKEN_BYTES = 32

export function generateAdminToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt)
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64url')
    expected = Buffer.from(parts[5] ?? '', 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  const actual = await derive(password, salt, { n, r, p, keylen: expected.length })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'base64url')
  const expected = Buffer.from(storedHash, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function derive(
  password: string,
  salt: Buffer,
  options: { n: number; r: number; p: number; keylen: number } = {
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keylen: KEY_BYTES,
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      options.keylen,
      {
        N: options.n,
        r: options.r,
        p: options.p,
        maxmem: 128 * options.n * options.r * 2,
      },
      (cause, key) => {
        if (cause) reject(cause)
        else resolve(key)
      }
    )
  })
}
