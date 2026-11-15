# syntax=docker/dockerfile:1.7

# Build the Clara desktop bundles for Linux and extract them to the host.
#
#   docker buildx build -f infra/docker/desktop.Dockerfile \
#     --target artifacts --output type=local,dest=dist/desktop .
#
# `pnpm desktop:build:docker` wraps this with the version stamp, the output
# directory, and the bundle selection.
#
# A Linux container can only produce Linux bundles (deb, rpm, AppImage).
# macOS and Windows installers need their own hosts.
#
# The container is based on Debian 12, Tauri's recommended baseline for Linux
# bundles. Override BASE_IMAGE only with a trusted image that provides Node 22
# and the same Debian packages.
ARG BASE_IMAGE=node:22-bookworm

FROM ${BASE_IMAGE} AS build

ENV DEBIAN_FRONTEND=noninteractive
ENV HUSKY=0
ENV PNPM_HOME=/pnpm
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/pnpm:/usr/local/cargo/bin:/usr/local/bin:$PATH

# Tauri's Linux prerequisites, plus the tools linuxdeploy needs for AppImage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      file \
      libayatana-appindicator3-dev \
      libfuse2 \
      librsvg2-dev \
      libssl-dev \
      libwebkit2gtk-4.1-dev \
      libxdo-dev \
      patchelf \
      wget \
    && rm -rf /var/lib/apt/lists/*

# The desktop shell bundles the adapter host as a Bun-compiled sidecar.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ARG RUST_VERSION=stable
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}"

RUN corepack enable

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# These manifest copies cover the workspace dependency closure of the desktop
# build: the Tauri CLI from @clara/desktop, the frontend from @clara/web, and the
# shared hub panel the web client renders at `/hub`.
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/desktop/host/package.json apps/desktop/host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/panel/package.json packages/panel/package.json
COPY packages/theme/package.json packages/theme/package.json
COPY packages/lab/package.json packages/lab/package.json
COPY packages/preview/package.json packages/preview/package.json
COPY packages/orchestration/policy/package.json packages/orchestration/policy/package.json
COPY packages/orchestration/engine/package.json packages/orchestration/engine/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/adapters/install/package.json packages/adapters/install/package.json
COPY packages/api/api-client/package.json packages/api/api-client/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
COPY packages/crypto/package.json packages/crypto/package.json
RUN pnpm install --frozen-lockfile --filter @clara/desktop... --filter @clara/desktop-host... --filter @clara/web...

# `apps/desktop` includes `apps/desktop/host`, the adapter host sidecar.
COPY apps/desktop apps/desktop
COPY apps/web apps/web
COPY packages/panel packages/panel
COPY packages/theme packages/theme
COPY packages/lab packages/lab
COPY packages/preview packages/preview
COPY packages/orchestration/policy packages/orchestration/policy
COPY packages/orchestration/engine packages/orchestration/engine
COPY packages/sqlite packages/sqlite
COPY tools/build tools/build
COPY packages/adapters/install packages/adapters/install
COPY packages/api/api-client packages/api/api-client
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/contracts/shared-types packages/contracts/shared-types
COPY packages/crypto packages/crypto

# `.git` is outside the context, so the CLI passes the version stamp instead.
ARG CLARA_COMMIT=
ARG CLARA_DIRTY=0
ARG TAURI_BUNDLES=deb,rpm,appimage
ENV CLARA_COMMIT=$CLARA_COMMIT \
    CLARA_DIRTY=$CLARA_DIRTY \
    TAURI_BUNDLES=$TAURI_BUNDLES
# linuxdeploy's strip step cannot read newer ELF relocation sections, and
# AppImage tooling needs FUSE; extract-and-run avoids requiring /dev/fuse.
ENV NO_STRIP=true \
    APPIMAGE_EXTRACT_AND_RUN=1

RUN --mount=type=cache,id=clara-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=clara-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=clara-desktop-target,target=/repo/apps/desktop/src-tauri/target \
    --mount=type=cache,id=clara-tauri-tools,target=/root/.cache/tauri \
    mkdir -p /out \
    && node apps/desktop/host/scripts/build.mjs \
    && cp "apps/desktop/src-tauri/binaries/clara-adapter-host-$(rustc -vV | sed -n 's/^host: //p')" /out/clara-adapter-host \
    && pnpm --dir apps/desktop exec tauri build --bundles "$TAURI_BUNDLES" \
    && find apps/desktop/src-tauri/target/release/bundle -type f -name '*.deb' \
         -exec cp -t /out/ {} + \
    && find apps/desktop/src-tauri/target/release/bundle -type f -name '*.rpm' \
         -exec cp -t /out/ {} + \
    && find apps/desktop/src-tauri/target/release/bundle -type f -name '*.AppImage' \
         -exec cp -t /out/ {} + \
    && cp apps/desktop/src-tauri/target/release/clara-desktop /out/ \
    && cp apps/desktop/src-tauri/Cargo.lock /out/Cargo.lock \
    && cd /out \
    && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
         | sort -z | xargs -0 sha256sum > SHA256SUMS

FROM scratch AS artifacts

COPY --from=build /out/ /
