# Client settings sync

## Summary

Paired devices can share a small set of non-secret preferences through the Clara
home agent. Each device chooses which categories it syncs from **Settings →
Sync**; the agent stores the values over the end-to-end encrypted session and
wins when a device disagrees. The agent panel controls whether sync is available
at all and how often clients check for changes.

## User flow

1. Pair Clara with a home agent over the relay or its local WebSocket. Direct
   HTTP mode has no sync because there is no Clara agent to store the values.
2. Open **Settings** and choose the **Sync** tab.
3. Turn on the categories this device should share: **Theme**, **Preferences**,
   **Models**, **Notifications**, **Project**, or **Inbox monitor**.
4. The first time a category is turned on, Clara pulls the agent's copy. A value
   the agent already has wins; a key it lacks is filled from this device.
5. Change a synced setting normally. Clara updates local storage immediately and
   pushes the changed key to the agent shortly after.
6. Leave Clara open. Every 30 seconds by default, each device asks only for the
   namespace revision. It pulls the full snapshot only when that revision moved,
   then applies the agent's values.
7. In the home agent panel, an admin can change the check interval or turn
   settings sync off entirely. Turning it off hides the Sync tab on every
   client and rejects sync requests.
8. The Sync card shows the current cadence, the last successful sync, any error,
   and **Sync now**.

## Core business rules

1. **Only non-secret preferences.** The server namespace rejects credential-like
   keys and is plaintext in SQLite. Pairing data, passwords, tokens, push
   endpoints, drafts, and message content never travel through it.
2. **The category choice is per device.** `clara.sync` stores the enabled
   categories, the last applied revision, and unsynced keys on this client. It is
   never uploaded, so two devices can sync different categories.
3. **First enable adopts the server.** A category pulls before it turns on. For
   every key in that category, an existing server value is applied; if the agent
   has no value, the local value is pushed. A failed pull leaves the category off.
4. **Server values win.** A pull applies the agent's values for enabled
   categories. A push conflict applies the value the agent already has and drops
   the losing local batch. Disabling a category stops applying and pushing but
   leaves the stored namespace intact.
5. **Check first, pull only when needed.** Local changes are pushed after a short
   debounce. The periodic timer sends `sync.check`, which returns only the
   namespace revision; the full `sync.pull` happens only when the revision moved.
   Reconnects, visibility resume, and **Sync now** follow the same rule.
6. **The panel owns the gate and cadence.** `sync.enabled` hides the feature on
   every client and makes the agent reject sync actions with `disabled`.
   `sync.intervalMs` is the client check cadence and defaults to 30 seconds. The
   agent broadcasts both values to connected clients as updated agent info.
7. **Notifications sync the preference, not the device.** Only sounds, UI sounds,
   volume, per-state sound switches, and the desk idle window sync. Browser
   permission, the desktop switch, and this device's push subscription stay
   local, so one device cannot unsubscribe another.
8. **Last project is saved state, not navigation.** A remote last project updates
   the remembered value; it never moves the current screen. The device's next
   project selection can overwrite it normally.
9. **Models sync as one group.** The separate **Models** category carries
   `clara.hiddenModels`, which contains the complete provider and model lists. A
   local toggle rewrites that one value, and a pull replaces the whole group.
   There are no per-provider or per-model sync entries.

## Edge cases

- **Direct HTTP connection** — the Sync tab stays visible but disabled and
  explains that it needs the Clara home agent.
- **Admin disables sync** — connected clients update from the agent's broadcast,
  the tab disappears, and the engine stops. The stored namespace and each
  device's category choices remain.
- **Admin changes the cadence** — connected clients reschedule their next check;
  new pairings receive the value in the initial agent info.
- **Unknown revision** — a client with no remembered revision pulls once to
  establish its cache before relying on revision checks.
- **Page reload** — the saved revision avoids an unnecessary full pull. Any keys
  recorded as dirty are pushed before the revision check.
- **Offline edits** — local changes are marked dirty while offline. Reconnecting
  pushes them with the remembered revision; if another device wrote first, the
  conflict snapshot wins.
- **Invalid server value** — the value is not applied, and the local usable value
  is pushed so the namespace can heal.
- **Model visibility conflict** — a pull replaces the entire hidden model group;
  individual toggles from the losing device are not merged.
- **Missing or extra keys in a category** — a key the agent lacks is filled from
  the first enabled device. Keys for categories this device did not enable are
  ignored.
- **Namespace limits** — the existing limits still apply: 100 entries per push,
  64 KB per value, 500 live entries, and 1 MB per namespace.
- **The agent is stopped** — no client can reach it. Sync resumes from the saved
  revision when the agent starts again.

## Out of scope

- A namespace picker, group management, or per-device namespaces
- A conflict-resolution UI or a history of prior values
- Syncing credentials, pairing payloads, drafts, or message content
- Deleting server entries from the web UI
- Syncing browser notification permission or a device's push subscription
- Per-client cadence overrides; the agent panel setting is global

## Technical appendix

<details>
<summary>Protocol, categories, and references</summary>

- Actions: `sync.check`, `sync.pull`, `sync.push` (default namespace `default`)
- States: `sync.revision`, `sync.snapshot`, `sync.error` (`invalid`,
  `too_large`, `conflict`, `disabled`, `storage`)
- Check result: `{ namespace, revision }`; snapshot:
  `{ namespace, revision, entries: [{ key, value, updatedAt }] }`
- Categories and keys:
  - Theme: `clara.theme`, `clara.colorTheme`
  - Preferences: `clara.defaultAgent`, `clara.lastAgent`,
    `clara.sessionWording`, `clara.costDisplay`
  - Models: `clara.hiddenModels`
  - Notifications: `clara.notifications` (sounds, UI sounds, volume,
    `soundKinds`, `deskIdleMs` only)
  - Project: `clara.lastProject`, `clara.showEmptyProjects`
  - Inbox: `clara.monitorInbox`
- Per-client state: `clara.sync` with `{ categories, revision, dirty }`; never
  uploaded
- Interval: `DEFAULT_SYNC_INTERVAL_MS` 30 s, `MIN_SYNC_INTERVAL_MS` 5 s,
  `MAX_SYNC_INTERVAL_MS` 15 min
- Panel: `POST /panel/api/v1/sync` with `{ enabled, intervalMs }`; controls
  return `sync: { enabled, intervalMs }`
- Tables: `client_storage` and `client_storage_revisions`
- Limits: 100 entries per push, 64 KB per value, 500 live entries, 1 MB per
  namespace
- Health: the panel storage card shows sync counts and bytes, never keys or
  values

Related: [settings.md](settings.md), [models.md](models.md), [theme.md](theme.md),
[notifications.md](notifications.md), [panel.md](panel.md),
[agent-controls.md](agent-controls.md), [e2ee.md](../architecture/e2ee.md).

</details>
