/**
 * The active harness product name, for copy that names it. Adapters enroll with
 * a display label; Clara never hardcodes the product name.
 */
export function harnessLabel(
  info: { harness: { active: { label: string } | null } } | null | undefined,
  fallback = 'your harness'
): string {
  const label = info?.harness.active?.label?.trim()
  return label || fallback
}
