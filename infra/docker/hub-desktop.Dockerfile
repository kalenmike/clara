# syntax=docker/dockerfile:1.7

# Build the Clara Hub app bundles for Linux and extract them to the host.
#
#   docker buildx build -f infra/docker/hub-desktop.Dockerfile \
#     --target artifacts --output type=local,dest=dist/hub .
#
# `pnpm hub:build:docker` wraps this with the version stamp, the output
# directory, the bundle selection, and the optional Cloudflare relay.
#
# The image builds the Bun sidecar first: the panel is compiled and embedded,
# then Tauri bundles the tray shell around the sidecar executable.
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
ENV PATH=/pnpm:/usr/local/cargo/bin:$PATH

# Tauri's Linux prerequisites, plus python3 for native module builds and the
# tools linuxdeploy needs for AppImage.
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
      python3 \
      wget \
    && rm -rf /var/lib/apt/lists/*

# The sidecar is compiled to a single executable with Bun.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ARG RUST_VERSION=stable
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}"

RUN corepack enable

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# These manifest copies cover the workspace dependency closure of the hub app
# build: the Tauri CLI from @clara/hub-desktop, the panel, the hub server, and
# the sidecar's runtime packages.
COPY apps/hub/desktop/package.json apps/hub/desktop/package.json
COPY apps/hub/panel/package.json apps/hub/panel/package.json
COPY apps/hub/server/package.json apps/hub/server/package.json
COPY packages/sqlite/package.json packages/sqlite/package.json
COPY packages/runtime-state/package.json packages/runtime-state/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/contracts/shared-types/package.json packages/contracts/shared-types/package.json
COPY packages/orchestration/control/package.json packages/orchestration/control/package.json
COPY packages/contracts/api-contract/package.json packages/contracts/api-contract/package.json
COPY packages/contracts/harness-protocol/package.json packages/contracts/harness-protocol/package.json
RUN pnpm install --frozen-lockfile \
      --filter @clara/hub-desktop... \
      --filter @clara/hub-panel...

COPY apps/hub/desktop apps/hub/desktop
COPY apps/hub/panel apps/hub/panel
COPY apps/hub/server apps/hub/server
COPY infra/relay infra/relay
COPY tools/build tools/build
COPY packages/sqlite packages/sqlite
COPY packages/runtime-state packages/runtime-state
COPY packages/crypto packages/crypto
COPY packages/contracts/shared-types packages/contracts/shared-types
COPY packages/orchestration/control packages/orchestration/control
COPY packages/contracts/api-contract packages/contracts/api-contract
COPY packages/contracts/harness-protocol packages/contracts/harness-protocol

# `.git` is outside the context, so the CLI passes the version stamp instead.
ARG CLARA_COMMIT=
ARG CLARA_DIRTY=0
ARG ENABLE_CLOUDFLARE_DEPLOYMENT=false
ARG TAURI_BUNDLES=deb,rpm,appimage
ENV CLARA_COMMIT=$CLARA_COMMIT \
    CLARA_DIRTY=$CLARA_DIRTY \
    ENABLE_CLOUDFLARE_DEPLOYMENT=$ENABLE_CLOUDFLARE_DEPLOYMENT \
    TAURI_BUNDLES=$TAURI_BUNDLES
# linuxdeploy's strip step cannot read newer ELF relocation sections, and
# AppImage tooling needs FUSE; extract-and-run avoids requiring /dev/fuse.
ENV NO_STRIP=true \
    APPIMAGE_EXTRACT_AND_RUN=1

RUN --mount=type=cache,id=clara-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=clara-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=clara-hub-desktop-target,target=/repo/apps/hub/desktop/src-tauri/target \
    --mount=type=cache,id=clara-tauri-tools,target=/root/.cache/tauri \
    node apps/hub/desktop/scripts/build-sidecar.mjs \
    && pnpm --dir apps/hub/desktop exec tauri build --bundles "$TAURI_BUNDLES" \
    && mkdir -p /out \
    && find apps/hub/desktop/src-tauri/target/release/bundle -type f -name '*.deb' \
         -exec cp -t /out/ {} + \
    && find apps/hub/desktop/src-tauri/target/release/bundle -type f -name '*.rpm' \
         -exec cp -t /out/ {} + \
    && find apps/hub/desktop/src-tauri/target/release/bundle -type f -name '*.AppImage' \
         -exec cp -t /out/ {} + \
    && cp apps/hub/desktop/src-tauri/target/release/clara-hub-desktop /out/ \
    && cp apps/hub/desktop/src-tauri/Cargo.lock /out/Cargo.lock \
    && cd /out \
    && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
         | sort -z | xargs -0 sha256sum > SHA256SUMS

FROM scratch AS artifacts

COPY --from=build /out/ /
