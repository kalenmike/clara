#!/usr/bin/env node
// Sign a release manifest and prepare the installer scripts.
//
//   CLARA_RELEASE_SIGNING_KEY=<pem> node scripts/sign-manifest.mjs \
//     --manifest dist/release/manifest.json \
//     --install-script scripts/install.sh \
//     --base-url https://github.com/owner/repo/releases/latest/download \
//     --out dist/release
//
// Writes `manifest.json.sig` (base64 Ed25519 signature), `public-key.txt`
// (base64 SPKI, for the binary build), and installers with the public key and
// release base URL substituted for their placeholders.

import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const manifestPath = resolve(requireArg('manifest'))
const outDir = resolve(args.out ?? '.')
const bytes = readFileSync(manifestPath)
const keyValue = process.env.CLARA_RELEASE_SIGNING_KEY ?? args.key
const baseUrl = requireArg('base-url').replace(/\/+$/, '')

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
  writeInstaller(installScript, join(outDir, 'install.sh'), true)
  const powershell = join(dirname(installScript), 'install.ps1')
  if (existsSync(powershell)) writeInstaller(powershell, join(outDir, 'install.ps1'), false)
}

if (args['public-key-out']) {
  writeFileSync(resolve(args['public-key-out']), `${publicKey}\n`)
}

function writeInstaller(source, target, publicKeySubstitution) {
  let text = readFileSync(source, 'utf8')
  text = text.replaceAll('__CLARA_RELEASE_BASE_URL__', baseUrl)
  if (publicKeySubstitution) text = text.replaceAll('__CLARA_RELEASE_PUBLIC_KEY__', publicKey)
  writeFileSync(target, text)
  console.log(`installer: ${target}`)
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
