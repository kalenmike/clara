---
title: Updates and backups
description: Rebuild Clara, update the PWA, and protect hub data.
sidebar_position: 5
---

# Updates and backups

## Update the host

From the checkout:

```bash
clara rebuild
```

The rebuild captures the running services, installs dependencies, builds the
checkout, reinstalls the configured harness adapters (the included OpenCode
adapter in this release), and restarts only the services that were running. It
then verifies their health and retries a failed restart once.

For a smaller change, rebuild and restart one target:

```bash
clara restart --build
clara restart --local --build
clara restart web --build
```

## Inspect or recover

```bash
clara rebuild status --json
clara rebuild health --json
clara rebuild inspect --json
clara rebuild recover --json
```

`recover` restores services from the current snapshot without rebuilding. It is
the right command after a failed restart, because re-capturing would record dead
services as stopped. A new `rebuild` is the only thing that takes a new snapshot.

## Update the installed app

The web app checks for a new service worker on launch and when it returns to the
foreground. When a deploy is newer, a banner offers **Update** or **Later**.

- **Update** waits for the new worker to take over, then reloads onto the new
  build. It never reloads onto the build that is already running.
- **Later** keeps the current build for this session. Closing every Clara window
  installs the update on the next launch.

One deploy asks once. Rebuilding the same commit is not treated as an update,
and an older deploy served out of order never prompts. If Clara is open in more
than one window, the window that accepts the update reloads and the others pick
up the new build the next time they navigate.

If the app is wedged, use **Settings → Advanced → Clear cached app data**. It
resets the service worker and caches but keeps pairing, settings, and drafts. A
device that is not paired yet uses the reload control at the bottom of the
pairing screen, beside the app and protocol versions.

## Back up

For Docker, stop the stack and archive the volumes:

```bash
clara stop
clara backup --output ~/clara-backup.tar.gz
```

For a local install, copy the config and data directories. The important files
are the hub database, `secrets.key`, `server.json`, `vapid.json`, and
`subscriptions.json`.

Do not copy the database while the hub is running if you can avoid it; stop the
hub first for a consistent snapshot.

## Restore

```bash
clara stop
clara restore ~/clara-backup.tar.gz --force
clara start --build
```

The restore replaces the Docker state volumes. For a local install, put the files
back in the config and data directories and restart.

## Check the result

```bash
clara status
clara logs hub
clara logs web
```

Open the hub panel and confirm the harness, local transport, relay, push, and
orchestration health. Pair a device again only if the device key or database was
replaced.

## Related

- [Docker](docker.md)
- [Local install](local.md)
- [Troubleshooting](../troubleshooting.md)
