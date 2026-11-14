# Adapter release tooling

Builds the Bun-compiled harness adapters and writes their static registry files.
The hub never bundles these artifacts; it reads the registry and runs the
install script on the target.

## CI release (the full matrix)

Run the **adapter-releases** workflow from **Actions → adapter-releases → Run
workflow**. It builds each OS on its own runner:

| Runner           | Targets                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `ubuntu-22.04`   | `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl` |
| `macos-14`       | `darwin-arm64`, `darwin-x64`                                     |
| `windows-latest` | `win32-x64`, `win32-arm64`                                       |

Inputs:

- `version` — optional; defaults to `<package version>-dev+<short commit>`.
- `kinds` — `all` or a comma list of `opencode`, `claude`, `pi`.
- `dry_run` — build and generate the registry without creating a release.

Each row builds the other architecture with Bun's same-OS cross-compilation. If
a particular target proves unreliable on a runner, split that target into its own
native runner row without changing the publish job.

The publish job:

1. Verifies every requested archive and hashes it.
2. Uploads the archives to the **`adapters-v<version>`** GitHub release.
3. Uploads the generated web registry as the **`adapter-registry`** workflow
   artifact. The web registry is deployed by the maintainer, not by this
   workflow.

Use `kinds: all` when the artifact will replace the whole web registry. A
partial `kinds` run contains only those harness directories; merge it with the
existing registry instead of replacing it.

The tag prefix is deliberate: the existing `hub-installers` workflow triggers
on `v*`, so `adapters-v*` keeps adapter releases separate from app releases.

Archive names include the adapter kind, so one release holds all three safely:

```
clara-adapter-opencode-v0.1.0-dev+abc1234-linux-x64.tar.gz
clara-adapter-claude-v0.1.0-dev+abc1234-linux-x64.tar.gz
clara-adapter-pi-v0.1.0-dev+abc1234-linux-x64.tar.gz
```

## Deploy the web registry

Download the `adapter-registry` artifact from the workflow run and place its
contents under `apps/web/public/adapters/`, then deploy the web app:

```bash
# after copying the artifact into apps/web/public/adapters/
pnpm deploy:web
```

The artifact path mirrors the web path:

```
apps/web/public/adapters/<harness>/manifest.json
apps/web/public/adapters/<harness>/v<version>-install.sh
```

## Local build (host only)

Local builds are for development and for the machine you are on. They default to
the host target and write to `dist/adapters`; they do not update the canonical
web registry.

```bash
pnpm adapters:build
pnpm adapters:build --print-targets
pnpm adapters:build --kind opencode --targets linux-x64,darwin-arm64
pnpm adapters:build --all-targets   # deliberate full local build
```

Outputs:

- `dist/adapters/<harness>/clara-adapter-<harness>-v<version>-<platform>.tar.gz`
- `dist/adapters/<harness>/manifest.json`
- `dist/adapters/<harness>/v<version>-install.sh`

The local manifest covers only the targets you built. Do not copy it to
`apps/web/public/adapters` unless it includes every platform you want to serve;
use the CI workflow for a complete registry.

## Registry contract

- `manifest.json` lists the version, install script, script SHA-256, and each
  platform archive URL and SHA-256.
- `v<version>-install.sh` detects the target, downloads the archive, verifies
  the archive hash, extracts it, and runs the adapter installer.
- The default release URL is
  `https://github.com/kalenmichael/clara/releases/download/adapters-v<version>`.
  Override it with `--artifact-base` when the release lives elsewhere.

The shell installer covers Linux and macOS. Windows users extract the archive
and run the adapter with Node. Release assets must be publicly readable for the
install script to download them.

The Claude Code adapter uses the `claude` binary already installed on the
machine; it does not embed the Agent SDK's platform binary. The installer passes
`--claude-path` when needed. The Pi adapter uses the machine's installed `pi`
binary in RPC mode.

The OpenCode archive contains the compiled adapter and its `plugin/` assets. The
installer passes `--no-runner`; the orchestration runner is not part of a remote
adapter install.
