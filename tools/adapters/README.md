# Adapter release tooling

Builds the Bun-compiled harness adapters, writes their static registry files,
and prints the GitHub upload commands. The hub never bundles these artifacts;
it reads the registry and runs the install script on the target.

```bash
pnpm adapters:build
pnpm adapters:build --kind opencode --targets linux-x64,darwin-arm64
pnpm adapters:build --version 0.1.0-dev+abc1234 \
  --artifact-base https://github.com/owner/repo/releases/download/v0.1.0-dev%2Babc1234
```

Outputs:

- `dist/adapters/<harness>/v<version>-<platform>.tar.gz`
- `apps/web/public/adapters/<harness>/manifest.json`
- `apps/web/public/adapters/<harness>/v<version>-install.sh`

Upload the tarballs to the GitHub release named by `--artifact-base`, then run
`pnpm deploy:web`. The manifest and script are small static files; the tarballs
stay on GitHub.

Supported platforms: `linux-x64`, `linux-arm64`, `linux-x64-musl`,
`linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.
The shell installer covers Linux and macOS. Windows users extract the archive
and run the adapter with Node.

The Claude Code adapter uses the `claude` binary already installed on the
machine; it does not embed the Agent SDK's platform binary. The installer passes
`--claude-path` when needed.

The OpenCode archive contains the compiled adapter and its `plugin/` assets. The
installer passes `--no-runner`; the orchestration runner is not part of a remote
adapter install.
