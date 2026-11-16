// GitHub release helpers shared by the adapter, desktop, and release tooling.
//
// Adapter and desktop releases use their own tag prefixes so the command
// releases (`v*`) never get confused with their archives. `latest` always means
// the newest published release with that prefix.

export const ADAPTER_TAG_PREFIX = 'adapters-v'
export const DESKTOP_TAG_PREFIX = 'desktop-v'

/** The version carried by an adapter, desktop, or command tag. */
export function versionFromTag(tag) {
  const match = /^(?:adapters-|desktop-)?v(.+)$/.exec(tag)
  return match ? match[1] : undefined
}

export function isAdapterTag(value) {
  return (
    typeof value === 'string' &&
    value.startsWith(ADAPTER_TAG_PREFIX) &&
    value.length > ADAPTER_TAG_PREFIX.length
  )
}

export function isDesktopTag(value) {
  return (
    typeof value === 'string' &&
    value.startsWith(DESKTOP_TAG_PREFIX) &&
    value.length > DESKTOP_TAG_PREFIX.length
  )
}

export function isCommandTag(value) {
  return typeof value === 'string' && /^v\d/.test(value)
}

/**
 * The newest published release tag matching `prefix`, or a command tag when
 * `prefix` is empty. Drafts are skipped because their assets are not
 * downloadable and a registry built from one would 404.
 */
export async function fetchLatestReleaseTag(options) {
  const { repo, apiUrl, token, fetchImpl, prefix = '', label = `${prefix}*` } = options
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubJson(`${apiUrl}/repos/${repo}/releases?per_page=100&page=${page}`, {
      token,
      fetchImpl,
    })
    if (!Array.isArray(batch) || batch.length === 0) break
    const release = batch.find(
      (entry) =>
        entry &&
        entry.draft !== true &&
        entry.prerelease !== true &&
        (prefix ? entry.tag_name?.startsWith(prefix) : isCommandTag(entry.tag_name))
    )
    if (release) return release.tag_name
    if (batch.length < 100) break
  }
  throw new Error(`No published ${label} release was found in ${repo}`)
}

export function fetchLatestAdapterTag(options) {
  return fetchLatestReleaseTag({ ...options, prefix: ADAPTER_TAG_PREFIX })
}

export function fetchLatestDesktopTag(options) {
  return fetchLatestReleaseTag({ ...options, prefix: DESKTOP_TAG_PREFIX })
}

export function fetchLatestCommandTag(options) {
  return fetchLatestReleaseTag({ ...options, prefix: '', label: 'v*' })
}

/** One release, including its tag, notes, dates, and assets. */
export async function fetchRelease(options) {
  const { repo, apiUrl, tag, token, fetchImpl } = options
  return githubJson(`${apiUrl}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    token,
    fetchImpl,
  })
}

/** Every asset of one release, keyed by file name. */
export async function fetchReleaseAssets(options) {
  const { repo, apiUrl, tag, token, fetchImpl } = options
  const release = await githubJson(
    `${apiUrl}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { token, fetchImpl }
  )
  const listed = Array.isArray(release.assets) ? release.assets : []
  const assetsUrl =
    release.id !== undefined
      ? `${apiUrl}/repos/${repo}/releases/${release.id}/assets`
      : release.assets_url
  const assets =
    assetsUrl && (listed.length === 0 || listed.length >= 30)
      ? await listAssets(assetsUrl, { token, fetchImpl })
      : listed
  return new Map(assets.map((asset) => [asset.name, asset]))
}

/**
 * The SHA-256 and size GitHub reports for an asset. Release assets are hashed
 * by GitHub itself, so a registry generated this way never downloads a file.
 */
export function assetMetadata(asset) {
  const digest = typeof asset.digest === 'string' ? asset.digest.trim() : ''
  const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest)
  if (!match) return undefined
  const metadata = { sha256: match[1].toLowerCase() }
  if (Number.isFinite(asset.size)) metadata.size = asset.size
  return metadata
}

export async function githubJson(url, options = {}) {
  const { token, fetchImpl = fetch } = options
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'clara-release',
    'x-github-api-version': '2022-11-28',
  }
  if (token) headers.authorization = `Bearer ${token}`

  let response
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) })
  } catch (cause) {
    throw new Error(`Could not reach ${url}: ${cause instanceof Error ? cause.message : cause}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const hint =
      response.status === 404
        ? ' Check the tag and --repo; private repositories need GITHUB_TOKEN or GH_TOKEN.'
        : ''
    const body = detail.trim() ? `\n${detail.trim()}` : ''
    throw new Error(`GitHub API ${response.status} for ${url}.${hint}${body}`)
  }
  return response.json()
}

async function listAssets(url, options) {
  const assets = []
  const base = url.split('?')[0]
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubJson(`${base}?per_page=100&page=${page}`, options)
    if (!Array.isArray(batch) || batch.length === 0) break
    assets.push(...batch)
    if (batch.length < 100) break
  }
  return assets
}
