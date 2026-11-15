export function devVersion(packageVersion: string, commit: string | undefined): string

export function buildVersion(options: {
  env?: NodeJS.ProcessEnv
  packageVersion: string
  commit: string | undefined
}): string
