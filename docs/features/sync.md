# Client settings sync

## Summary

The home agent can store non-secret browser preferences so paired devices can
share one set of settings. The server-side protocol and database exist today;
the web client does not call them yet.

## User flow

1. A paired browser opens an authenticated E2EE session with the home agent.
2. It sends `sync.pull` for the default namespace and receives a snapshot with a
   revision and every stored entry.
3. It sends `sync.push` with the entries it changed and the revision it started
   from.
4. The agent records the values, increments the namespace revision, and returns
   the new snapshot.
5. Conflicts return the current snapshot so a future UI can merge and retry.
6. There is no Clara screen for this yet: the web app neither pulls nor pushes
   settings.

## Core business rules

1. **Only non-secret preferences.** The sync table is plaintext in SQLite. Keys
   that look like credentials are rejected before anything is written.
2. **One shared namespace per agent by default.** Paired devices already share
   the PSK, so the default namespace is shared. The namespace field exists for a
   future grouping UI but group management is not built.
3. **Server time wins.** Entry timestamps come from the agent when it receives
   the push, not from the client. A push increments the namespace revision once.
4. **Deletes are tombstones.** A `null` value writes a tombstone and is returned
   to other devices, so a delete can propagate without deleting the row.
5. **Sync is E2EE-only.** Values are readable only inside an authenticated
   session. The panel shows counts and bytes, never keys or values.

## Edge cases

- **No sync store** — the agent answers `sync.error` with code `storage`.
- **Stale base revision** — the agent returns `sync.error` with code `conflict`
  and the current revision and entries.
- **Secret-bearing key** — a key beginning with `clara.connection.` or containing
  a credential word is rejected with code `invalid`.
- **Oversized value** — a value over 64 KB is rejected with code `too_large`.
- **Too many changes** — more than 100 entries in one push, more than 500 live
  entries in a namespace, or more than 1 MB of values in a namespace is
  rejected with `too_large`.
- **Invalid namespace or key** — namespaces must be 1–64 lowercase letters,
  numbers, underscores, or dashes; keys are 1–128 characters with no control
  characters.
- **Process restart** — values, tombstones, and revisions survive reopening the
  database.
- **Partial batch** — validation and limits are checked before writing, so a
  rejected push changes nothing.

## Out of scope

- A web settings sync page, sync button, or namespace picker
- Group management, per-device namespaces, or conflict-resolution UI
- Syncing credentials, pairing payloads, drafts, or message content
- End-to-end encryption of the SQLite file itself

## Known gaps

- The web client does not use the protocol yet, so no device syncs today.
- Draft text lives under `clara.draft.*`; it is not a credential but a future UI
  should exclude it from sync.

## Technical appendix

<details>
<summary>Protocol, limits, and the key denylist</summary>

- Actions: `sync.pull` and `sync.push` (default namespace `default`)
- States: `sync.snapshot` and `sync.error` (`invalid`, `too_large`, `conflict`,
  `disabled`, `storage`)
- Snapshot: namespace, revision, entries `{ key, value, updatedAt }`
- Tables: `client_storage` and `client_storage_revisions`
- Limits: 100 entries per push, 64 KB per value, 500 live entries and 1 MB per
  namespace

The denylist rejects any key that starts with `clara.connection.` or contains
`psk`, `password`, `passwd`, `token`, `secret`, `credential`, `authorization`,
`private-key`, or `pairing`, case-insensitively. The audited web storage keys
are `clara.connection.local`, `clara.connection.session`, `clara.colorTheme`,
`clara.composerSize`, `clara.defaultAgent`, `clara.draft.*`,
`clara.internalMessages`, `clara.lastAgent`, `clara.lastProject`,
`clara.monitorInbox`, `clara.notifications`, `clara.push.subscription-change`,
`clara.sessionWording`, `clara.showEmptyProjects`, `clara.sidebar`,
`clara.sidebarSections`, `clara.sidebarWidth`, `clara.sidePanelTab`,
`clara.sidePanelWidth`, and `clara.theme`.

Related: [agent-controls.md](agent-controls.md),
[e2ee.md](../architecture/e2ee.md), [pairing.md](pairing.md).

</details>
