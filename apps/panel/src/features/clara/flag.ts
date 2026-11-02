/**
 * Build-time inclusion switch for the experimental Clara management feature.
 *
 * `VITE_CLARA_MANAGEMENT=0` (or `false`/`off`) excludes the management card
 * from the panel bundle.
 */
export const CLARA_FEATURE_INCLUDED = (() => {
  const flag = import.meta.env.VITE_CLARA_MANAGEMENT?.trim().toLowerCase()
  return flag !== '0' && flag !== 'false' && flag !== 'off'
})()
