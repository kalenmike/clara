/** Version with the build commit, e.g. `0.1.0.90d9f352`. */
export function displayVersion(version: string, commit: string | null | undefined): string {
  return commit ? `${version}.${commit}` : version
}
