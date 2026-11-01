/**
 * True for elements where the browser owns editing keys such as cut, copy, and
 * paste. Global shortcuts stay out of these so text editing keeps working.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
