import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactUrls } from '../../adapters/lib/urls.mjs'

const file = 'clara-adapter-opencode-v0.1.0-dev+abc1234-linux-x64.tar.gz'
const encoded = encodeURIComponent(file)

test('a local manifest points at the archive beside itself', () => {
  const urls = artifactUrls({
    fromRelease: false,
    artifactBase: 'https://github.com/example/clara/releases/download/adapters-v0.1.0-dev+abc1234',
    artifactBaseExplicit: false,
    kind: 'opencode',
    file,
  })

  assert.equal(urls.manifest, `./${encoded}`)
  assert.equal(
    urls.script,
    `https://github.com/example/clara/releases/download/adapters-v0.1.0-dev+abc1234/${encoded}`
  )
})

test('a served local build prefixes the kind and works in the script', () => {
  const urls = artifactUrls({
    fromRelease: false,
    artifactBase: 'http://127.0.0.1:8799',
    artifactBaseExplicit: true,
    kind: 'opencode',
    file,
  })

  assert.equal(urls.manifest, `http://127.0.0.1:8799/opencode/${encoded}`)
  assert.equal(urls.script, urls.manifest)
})

test('a release keeps the flat GitHub asset URL', () => {
  const releaseUrl = `https://github.com/example/clara/releases/download/adapters-v0.1.0/${encoded}`
  const urls = artifactUrls({
    fromRelease: true,
    artifactBase: 'https://github.com/example/clara/releases/download/adapters-v0.1.0',
    artifactBaseExplicit: false,
    kind: 'opencode',
    file,
    releaseUrl,
  })

  assert.equal(urls.manifest, releaseUrl)
  assert.equal(urls.script, releaseUrl)
})

test('a release mirror keeps the flat base', () => {
  const urls = artifactUrls({
    fromRelease: true,
    artifactBase: 'https://mirror.example.com/adapters-v0.1.0',
    artifactBaseExplicit: true,
    kind: 'opencode',
    file,
  })

  assert.equal(urls.manifest, `https://mirror.example.com/adapters-v0.1.0/${encoded}`)
  assert.equal(urls.script, urls.manifest)
})
