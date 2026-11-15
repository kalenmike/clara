/** Read a Clara engine variable, falling back to its historical name. */
export function engineEnv(name: string, legacy: string): string | undefined {
  return process.env[name]?.trim() || process.env[legacy]?.trim()
}
