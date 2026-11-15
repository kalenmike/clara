// Adapter registry URLs for the manifest and the shell install script.
//
// A local build is consumed from a directory served as the registry, so its
// manifest points at the archive beside itself and a static server works at any
// mount point. A served build (or a release mirror) uses an absolute base.
// Release builds keep the flat layout of a GitHub release, which the install
// script also downloads from.

/**
 * @param {{
 *   fromRelease: boolean
 *   artifactBase: string
 *   artifactBaseExplicit: boolean
 *   kind: string
 *   file: string
 *   releaseUrl?: string
 * }} input
 * @returns {{ manifest: string; script: string }}
 */
export function artifactUrls(input) {
  const encoded = encodeURIComponent(input.file)
  if (input.fromRelease) {
    const url = input.artifactBaseExplicit
      ? `${input.artifactBase}/${encoded}`
      : (input.releaseUrl ?? `${input.artifactBase}/${encoded}`)
    return { manifest: url, script: url }
  }
  if (input.artifactBaseExplicit) {
    const url = `${input.artifactBase}/${input.kind}/${encoded}`
    return { manifest: url, script: url }
  }
  return {
    manifest: `./${encoded}`,
    script: `${input.artifactBase}/${encoded}`,
  }
}
