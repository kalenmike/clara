/**
 * Build-time inclusion switch for the experimental Clara management feature.
 *
 * `VITE_CLARA_MANAGEMENT=0` (or `false`/`off`) excludes the management card
 * from the panel bundle.
 */
const flag = import.meta.env.VITE_CLARA_MANAGEMENT
export const CLARA_FEATURE_INCLUDED = flag !== '0' && flag !== 'false' && flag !== 'off'
