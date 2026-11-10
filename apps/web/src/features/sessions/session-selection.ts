export type SelectionState = {
  anchorID: string | null
  selectedIDs: ReadonlySet<string>
}

/**
 * Select the inclusive range between the anchor and target in rendered order.
 * A missing anchor or target starts a new selection at the target.
 */
export function selectRange(
  orderedIDs: readonly string[],
  anchorID: string | null,
  targetID: string
): SelectionState {
  const targetIndex = orderedIDs.indexOf(targetID)
  const anchorIndex = anchorID === null ? -1 : orderedIDs.indexOf(anchorID)

  if (targetIndex === -1 || anchorIndex === -1) {
    return { anchorID: targetID, selectedIDs: new Set([targetID]) }
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)

  return {
    anchorID,
    selectedIDs: new Set(orderedIDs.slice(start, end + 1)),
  }
}

/**
 * Drop selected IDs that are no longer available and clear an anchor that no
 * longer exists. Return the same object when nothing changed so callers can
 * avoid a render loop.
 */
export function pruneSelection(
  selection: SelectionState,
  availableIDs: ReadonlySet<string>
): SelectionState {
  let changed = selection.anchorID !== null && !availableIDs.has(selection.anchorID)
  const selectedIDs = new Set<string>()

  for (const id of selection.selectedIDs) {
    if (availableIDs.has(id)) selectedIDs.add(id)
    else changed = true
  }

  if (!changed) return selection

  return {
    anchorID:
      selection.anchorID !== null && availableIDs.has(selection.anchorID)
        ? selection.anchorID
        : null,
    selectedIDs,
  }
}
