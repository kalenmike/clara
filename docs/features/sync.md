# Client settings sync

## Summary

Paired devices can share a small set of non-secret preferences through the Clara
hub. Each device chooses which categories, and which isolated single settings, it
syncs from **Settings → Sync**; the hub stores the values over the end-to-end
encrypted session and wins when a device disagrees. The hub panel gates the
feature and sets how often clients check, and the Sync tab itself is never
synchronized. See [connection](connection.md) for pairing and
[E2EE](../architecture/e2ee.md) for the transport.

## User flow

1. Pair Clara with a hub over the relay or its local WebSocket; direct HTTP mode
   has no sync because there is no hub to store the values.
2. Open **Settings** and choose the **Sync** tab; see [settings](settings.md).
3. Turn on the categories this device should share: **Theme**, **Preferences**,
   **Models**, **Notifications**, **Project**, or **Inbox monitor**. The separate
   **Single setting** section can share **Orchestrator mode** on its own.
4. The first time a category is turned on, Clara pulls the hub's copy: existing
   hub values win and keys the hub lacks are filled from this device.
5. Change a synced setting normally. Clara writes local storage immediately and
   pushes the changed key to the hub shortly after.
6. Leave Clara open. Every 30 seconds by default, each device asks only for the
   namespace revision and pulls the full snapshot only when that revision moved.
7. An admin can change the cadence or turn sync off in the hub panel; see
   [panel controls](panel/controls.md). Turning it off hides the Sync tab and
   rejects sync requests.
8. The Sync card shows the cadence, the last successful sync, any error, and
   **Sync now**.

## Core business rules

1. **Only non-secret preferences.** The server namespace rejects credential-like
   keys and is plaintext in SQLite. Pairing data, passwords, tokens, push
   endpoints, drafts, and message content never travel through it.
2. **The choice is per device, and hub values win.** `clara.sync` stores the
   enabled categories, enabled isolated settings, the last applied revision, and
   unsynced keys on this client; it is never uploaded, so two devices can sync
   different choices. First enable adopts the server: the choice pulls before it
   turns on, an existing server value is applied, a key the hub lacks is filled
   from this device, and a failed pull leaves the choice off. A later pull applies
   the hub's values, a push conflict applies the value the hub already has and
   drops the losing local batch, and disabling a choice stops applying and pushing
   but leaves the stored namespace intact.
3. **Check first, pull only when needed.** Local changes are pushed after a short
   debounce. The periodic timer sends `sync.check`, which returns only the
   namespace revision; the full `sync.pull` happens only when the revision moved.
   Reconnects, visibility resume, and **Sync now** follow the same rule. The panel
   owns the gate and cadence: `sync.enabled` hides the feature everywhere and
   makes the hub reject sync with `disabled`, while `sync.intervalMs` is the check
   cadence (30 seconds by default), broadcast with the status to every client.
4. **Records move whole and per harness.** The **Models** category carries
   `clara.hiddenModels`, and **Preferences** carries `clara.defaultAgent` and
   `clara.lastAgent`; each is a v2 record keyed by harness. A local toggle rewrites
   that one group, a pull replaces it whole, v1 values are rejected, and an agent
   chosen on one harness never applies to another. Notifications sync only sounds,
   UI sounds, volume, per-state switches, and the desk idle window, while
   permission, the desktop switch, and this device's push subscription stay local;
   see [notifications](notifications.md).
5. **Saved state and isolated choices.** A remote last project updates the
   remembered value and never moves the current screen; the device's next project
   selection can overwrite it normally. The isolated **Orchestrator mode** setting
   is outside every category and shares only `clara.orchestratorMode`, the
   per-client choice to use the engine surface; enabling it enables no category,
   and disabling it leaves every category unchanged.

## Edge cases

- **Not connected** — the Sync tab stays visible but disabled until the hub
  transport is open, and no client can reach the hub.
- **Admin disables sync** — connected clients update from the broadcast, the tab
  disappears, and the engine stops. The stored namespace and each device's
  category choices remain.
- **Admin changes the cadence** — connected clients reschedule their next check,
  and new pairings receive the value in the initial hub status.
- **Unknown revision** — a client with no remembered revision pulls once to
  establish its cache before relying on revision checks.
- **Page reload** — the saved revision avoids an unnecessary full pull, and any
  keys recorded as dirty are pushed before the revision check.
- **Offline edits** — local changes are marked dirty while offline. Reconnecting
  pushes them with the remembered revision; if another device wrote first, the
  conflict snapshot wins.
- **Invalid server value** — the value is not applied, and the local usable value
  is pushed so the namespace can heal.
- **Model visibility conflict** — a pull replaces the entire per-harness hidden
  model group; individual toggles from the losing device are not merged.
- **Missing or extra keys in a choice** — a key the hub lacks is filled from the
  first enabled device, and keys for choices this device did not enable are
  ignored.
- **Namespace limits** — 100 entries per push, 64 KB per value, 500 live entries,
  and 1 MB per namespace; a value over them fails with `too_large` and the local
  value stays in place.

## Out of scope

- A namespace picker, group management, or per-device namespaces
- A conflict-resolution UI or a history of prior values
- Syncing credentials, pairing payloads, drafts, or message content
- Deleting server entries from the web UI
- Syncing browser notification permission or a device's push subscription
- Per-client cadence overrides; the hub panel setting is global

## Technical appendix

<details>
<summary>Protocol, categories, and references</summary>

- Actions: `sync.check`, `sync.pull`, `sync.push` (default namespace `default`)
- States: `sync.revision`, `sync.snapshot`, `sync.error` (`invalid`,
  `too_large`, `conflict`, `disabled`, `storage`)
- Check result: `{ namespace, revision }`; snapshot:
  `{ namespace, revision, entries: [{ key, value, updatedAt }] }`
- Categories and keys:
  - Theme: `clara.theme`, `clara.colorTheme`; see [theme](theme.md)
  - Preferences: `clara.defaultAgent`, `clara.lastAgent` (both v2, per harness),
    `clara.sessionWording`, `clara.costDisplay`
  - Models: `clara.hiddenModels` (v2, per harness); see [models](models.md)
  - Notifications: `clara.notifications` (sounds, UI sounds, volume,
    `soundKinds`, `deskIdleMs` only)
  - Project: `clara.lastProject`, `clara.showEmptyProjects`,
    `clara.showArchivedProjects`
  - Inbox: `clara.monitorInbox`
  - Single setting: Orchestrator mode: `clara.orchestratorMode`
- Per-client state: `clara.sync` with `{ categories, standalone, revision, dirty }`;
  never uploaded
- Interval: `DEFAULT_SYNC_INTERVAL_MS` 30 s, `MIN_SYNC_INTERVAL_MS` 5 s,
  `MAX_SYNC_INTERVAL_MS` 15 min
- Panel: `POST /panel/api/v1/sync` with `{ enabled, intervalMs }`; controls
  return `sync: { enabled, intervalMs }`
- Tables: `client_storage` and `client_storage_revisions`
- Limits: 100 entries per push, 64 KB per value, 500 live entries, 1 MB per
  namespace
- Health: the panel storage card shows sync counts and bytes, never keys or values

Related: [settings.md](settings.md), [models.md](models.md), [theme.md](theme.md),
[notifications.md](notifications.md), [panel controls](panel/controls.md),
[connection.md](connection.md), [E2EE](../architecture/e2ee.md).

</details>
