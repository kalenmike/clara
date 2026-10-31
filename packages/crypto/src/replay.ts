/**
 * WebSocket frames are ordered per session, so a strict sequence is enough.
 * A duplicated, skipped, or replayed frame is rejected before decryption.
 */
export class ReplayGuard {
  private next = 0

  check(seq: number): void {
    if (!Number.isSafeInteger(seq) || seq !== this.next) {
      throw new Error(`Unexpected frame sequence ${seq}; expected ${this.next}`)
    }
    this.next += 1
  }

  get expected(): number {
    return this.next
  }

  reset(): void {
    this.next = 0
  }
}
