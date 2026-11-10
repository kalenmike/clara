/**
 * Pick the row to focus after a successful bulk delete.
 *
 * Prefer the first surviving row after the deleted range in the pre-deletion
 * order, then the first surviving row before it. A row only counts as
 * surviving when it was not deleted and still appears in the rendered order.
 */
export function resolveDeleteFocusTarget(
  beforeOrder: readonly string[],
  afterOrder: readonly string[],
  deletedIDs: ReadonlySet<string>
): string | null {
  const after = new Set(afterOrder)
  let firstDeleted = -1
  let lastDeleted = -1

  beforeOrder.forEach((id, index) => {
    if (!deletedIDs.has(id)) return
    if (firstDeleted === -1) firstDeleted = index
    lastDeleted = index
  })

  if (firstDeleted === -1) return null

  const survives = (id: string) => !deletedIDs.has(id) && after.has(id)

  for (let index = lastDeleted + 1; index < beforeOrder.length; index += 1) {
    const id = beforeOrder[index]
    if (id !== undefined && survives(id)) return id
  }

  for (let index = firstDeleted - 1; index >= 0; index -= 1) {
    const id = beforeOrder[index]
    if (id !== undefined && survives(id)) return id
  }

  return null
}
