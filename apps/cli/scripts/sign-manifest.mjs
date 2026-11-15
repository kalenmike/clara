#!/usr/bin/env node
// Sign a release manifest and prepare the installer public key.
//
//   CLARA_RELEASE_SIGNING_KEY=<pem> node scripts/sign-manifest.mjs \
//     --manifest dist/release/manifest.json \
//     --install-script scripts/install.sh \
//     --out dist/release
//
// Writes `manifest.json.sig` (base64 Ed25519 signature), `public-key.txt`
// (base64 SPKI, for the binary build), and an `install.sh` with the public key
// substituted for `__CLARA_RELEASE_PUBLIC_KEY__`.

import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const manifestPath = resolve(requireArg('manifest'))
const outDir = resolve(args.out ?? '.')
const bytes = readFileSync(manifestPath)
const keyValue = process.env.CLARA_RELEASE_SIGNING_KEY ?? args.key

if (!keyValue) {
  fail('set CLARA_RELEASE_SIGNING_KEY to an Ed25519 private key in PEM form')
}

const privateKey = createPrivateKey(keyValue)
if (privateKey.asymmetricKeyType !== 'ed25519') {
  fail('the signing key must be Ed25519')
}
const signature = sign(null, bytes, privateKey)
const publicKey = createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .toString('base64')

writeFileSync(join(outDir, 'manifest.json.sig'), `${signature.toString('base64')}\n`)
writeFileSync(join(outDir, 'public-key.txt'), `${publicKey}\n`)
console.log(`signature: ${join(outDir, 'manifest.json.sig')}`)
console.log(`public key: ${join(outDir, 'public-key.txt')}`)

const installScript = args['install-script'] ? resolve(args['install-script']) : undefined
if (installScript) {
  const text = readFileSync(installScript, 'utf8')
  writeFileSync(
    join(outDir, 'install.sh'),
    text.replaceAll('__CLARA_RELEASE_PUBLIC_KEY__', publicKey)
  )
  console.log(`installer: ${join(outDir, 'install.sh')}`)
}

if (args['public-key-out']) {
  copyFileSync(join(outDir, 'public-key.txt'), resolve(args['public-key-out']))
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      values[key] = next
      index += 1
    } else {
      values[key] = true
    }
  }
  return values
}

function requireArg(name) {
  const value = args[name]
  if (typeof value !== 'string' || value.length === 0) fail(`--${name} is required`)
  return value
}

function fail(message) {
  console.error(`release signing: ${message}`)
  process.exit(1)
}
