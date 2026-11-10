import type { TimelineItem } from '@/features/chat/timeline'

export type MessageStepDirection = 'up' | 'down'

/**
 * Find the next or previous transcript row that carries a message. System
 * events and hidden-activity rows are skipped so a step always lands on a real
 * message header instead of a divider or a thinking footer.
 */
export function stepMessageIndex(
  items: readonly TimelineItem[],
  currentIndex: number,
  direction: MessageStepDirection
): number | null {
  if (items.length === 0) return null

  if (direction === 'down') {
    for (let index = Math.max(0, currentIndex + 1); index < items.length; index += 1) {
      if (items[index]?.type === 'message') return index
    }
    return null
  }

  for (let index = Math.min(currentIndex - 1, items.length - 1); index >= 0; index -= 1) {
    if (items[index]?.type === 'message') return index
  }
  return null
}
