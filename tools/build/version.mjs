/**
 * Version identity shared by the build scripts.
 *
 * A release build passes its version explicitly. A checkout build identifies
 * the commit it came from, e.g. `0.1.0-dev+abc1234`, so two local builds never
 * look like the same artifact.
 */
export function devVersion(packageVersion, commit) {
  return `${packageVersion}-dev+${commit || 'local'}`
}

export function buildVersion({ env = process.env, packageVersion, commit }) {
  const configured = env.CLARA_VERSION?.trim()
  return configured || devVersion(packageVersion, commit)
}
