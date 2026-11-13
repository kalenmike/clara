/**
 * Build-time feature switches.
 *
 * These are deliberately not runtime settings. A production build either
 * contains the feature or it does not, so an operator cannot turn it on by
 * editing a config file or an environment variable after the fact.
 */
export function featureEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase())
}
