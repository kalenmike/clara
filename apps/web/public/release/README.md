# Release registry

The website serves the one-line installers and the signed release manifest:

```
/install
/install.ps1
/release/manifest.json
/release/manifest.json.sig
/release/public-key.txt
```

`manifest.json` nests one object per component. The command and desktop
releases are published separately, so each carries its own version:

```json
{
  "schemaVersion": 2,
  "channel": "stable",
  "cli": { "version": "0.2.0", "artifacts": {} },
  "desktop": { "version": "0.2.0", "artifacts": {} }
}
```

These files are generated from the newest published GitHub releases. Do not
edit them by hand. Rebuild and check the registry with:

```bash
CLARA_RELEASE_SIGNING_KEY=<pem> pnpm release:registry
pnpm release:check
```

Or copy the signed `release-registry` workflow artifact:

```bash
gh run download <run-id> -n release-registry -D dist/release-registry
pnpm deploy:web:release --from dist/release-registry
```

The generated files are committed like the adapter registry so a later
`pnpm deploy:web` keeps the endpoints online. The web `predeploy` check ignores
an entirely missing registry during first-time setup and validates it once the
files exist.
