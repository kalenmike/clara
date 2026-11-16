# Release registry tooling

The website serves the one-line installers and the signed component manifest:

```
https://clara.kalenmichael.com/install
https://clara.kalenmichael.com/install.ps1
https://clara.kalenmichael.com/release/manifest.json
```

The manifest uses `schemaVersion: 2` with one object per component:

```json
{
  "schemaVersion": 2,
  "channel": "stable",
  "generatedAt": "…",
  "cli": { "version": "0.2.0", "tag": "v0.2.0", "artifacts": {} },
  "desktop": { "version": "0.2.0", "tag": "desktop-v0.2.0", "artifacts": {} }
}
```

`cli` and `desktop` are published from separate releases and can carry
different versions. The command manifest on a GitHub release uses the same
shape.

## Commands

```bash
# Build the signed registry from the latest published releases
CLARA_RELEASE_SIGNING_KEY=<pem> pnpm release:registry

# Verify the local registry against the latest releases
pnpm release:check

# Generate, check, and deploy the Pages project
CLARA_RELEASE_SIGNING_KEY=<pem> pnpm deploy:web:release

# Copy a CI artifact, check it, and deploy
gh run download <run-id> -n release-registry -D dist/release-registry
pnpm deploy:web:release --from dist/release-registry
```

`pnpm deploy:web` also runs the offline registry check. It ignores an entirely
missing registry during first-time setup and fails once the files exist but are
invalid.

## Files

- `registry.mjs` composes the manifest from GitHub release metadata and signs
  it. It does not upload release archives.
- `check-registry.mjs` validates the signature, installer substitutions, every
  command platform, desktop asset names, and the release checksums.
- `deploy.mjs` copies an artifact or regenerates the registry, checks it, and
  deploys the web app.
- `lib.mjs` owns the command platform list and the desktop asset patterns.

The generated files under `apps/web/public` are committed like the adapter
registry so a later Pages deploy cannot take the installer offline.
