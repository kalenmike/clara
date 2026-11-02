/**
 * Build-time inclusion switch for the experimental Clara management feature.
 *
 * This is deliberately separate from `management.enabled`: the environment
 * flag decides whether the feature is loaded at all, while the database setting
 * decides whether it does anything. Set `CLARA_MANAGEMENT=0` (or `false`/`off`)
 * to build and run the agent without Clara management code.
 */
export function claraFeatureIncluded(): boolean {
  const flag = process.env.CLARA_MANAGEMENT?.trim().toLowerCase()
  return flag !== '0' && flag !== 'false' && flag !== 'off'
}
