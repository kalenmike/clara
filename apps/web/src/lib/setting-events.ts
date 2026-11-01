type SettingListener = (key: string) => void

const listeners = new Set<SettingListener>()

/**
 * A same-tab notification that a syncable preference was written. It is not a
 * storage event: the sync engine needs to observe the tab that made the change.
 */
export function notifySettingChanged(key: string): void {
  for (const listener of listeners) {
    try {
      listener(key)
    } catch {
      // Settings listeners must not break the save path.
    }
  }
}

export function subscribeSettingChanged(listener: SettingListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
