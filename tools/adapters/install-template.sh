#!/bin/sh
# Clara __KIND__ adapter __VERSION__
#
#   curl -fsSL https://clara.kalenmichael.com/adapters/__KIND__/v__VERSION__-install.sh \
#     | sh -s -- --pair <code>
#
# Downloads the Bun-compiled adapter for this machine, verifies its SHA-256,
# extracts it, and runs the adapter installer.
set -eu

KIND='__KIND__'
VERSION='__VERSION__'
DEFAULT_ARGS='__DEFAULT_ARGS__'

say() { printf '%s\n' "$*"; }
fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

download() {
  if command -v curl >/dev/null 2>&1; then
    # A local development registry answers on loopback HTTP. Everything else
    # stays HTTPS-only, including redirects.
    proto='=https'
    case "$1" in
      http://127.0.0.1:* | http://localhost:* | http://\[::1\]:*) proto='=https,http' ;;
    esac
    curl -fsSL --proto "$proto" --tlsv1.2 --connect-timeout 10 --max-time 300 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "Clara needs curl or wget on this machine to download the adapter."
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    fail "Clara needs sha256sum, shasum, or openssl to verify the adapter."
  fi
}

os=$(uname -s 2>/dev/null || true)
arch=$(uname -m 2>/dev/null || true)

case "$os" in
  Linux)
    case "$arch" in
      x86_64 | amd64) platform='linux-x64' ;;
      aarch64 | arm64) platform='linux-arm64' ;;
      *) fail "Clara has no Linux build for $arch." ;;
    esac
    if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then
      platform="${platform}-musl"
    fi
    ;;
  Darwin)
    case "$arch" in
      x86_64 | amd64) platform='darwin-x64' ;;
      aarch64 | arm64) platform='darwin-arm64' ;;
      *) fail "Clara has no macOS build for $arch." ;;
    esac
    ;;
  *)
    fail "Clara has no shell installer for $os. Download the adapter release for your platform and run it with Node."
    ;;
esac

say "Clara $KIND $VERSION for $platform"

case "$platform" in
__ARTIFACT_CASES__
  *) fail "Clara has no $KIND build for $platform." ;;
esac

root="${CLARA_ADAPTER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}}/clara/adapters/$KIND/$VERSION"
tmp=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/clara-adapter-$$.tar.gz")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

say "Downloading the $KIND adapter"
download "$url" "$tmp"
actual=$(sha256 "$tmp")
[ "$actual" = "$sha" ] || fail "The adapter checksum did not match."

mkdir -p "$root"
tar -xzf "$tmp" -C "$root" || fail "Could not extract the adapter."
chmod +x "$root/clara-adapter-$KIND"
say "Installed to $root"

: "${CLARA_ADAPTER_REGISTRY_URL:=__REGISTRY__}"
export CLARA_ADAPTER_REGISTRY_URL
export CLARA_ADAPTER_VERSION="$VERSION"
exec "$root/clara-adapter-$KIND" install "$@" $DEFAULT_ARGS
