/**
 * A Clara daemon worker session. These are normal stage handoffs, not
 * exceptions; when Clara management is on the exception session is the
 * actionable conversation instead.
 */
export function isClaraWorkerTitle(title: string | undefined): boolean {
  return /^(Spec|Test|Build|Docs|Judge) · \d{3} /.test(title?.trim() ?? '')
}
