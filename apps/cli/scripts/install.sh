#!/bin/sh
# Clara installer.
#
#   curl -fsSL https://github.com/kalenmike/clara/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --version 0.2.0
#
# Downloads the signed release manifest, verifies it, installs the matching
# archive under ~/.local/share/clara/versions, and links `clara` into
# ~/.local/bin.
set -eu

BASE_URL="${CLARA_RELEASE_BASE_URL:-https://github.com/kalenmike/clara/releases/latest/download}"
VERSION=""
BIN_DIR="${CLARA_BIN_DIR:-$HOME/.local/bin}"
PUBLIC_KEY='__CLARA_RELEASE_PUBLIC_KEY__'

say() { printf '%s\n' "$*"; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --bin-dir) BIN_DIR="${2:-}"; shift 2 ;;
    -h|--help)
      say "Usage: install.sh [--version <v>] [--base-url <url>] [--bin-dir <dir>]"
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

command -v curl >/dev/null 2>&1 || fail "Clara needs curl to download the release."
command -v tar >/dev/null 2>&1 || fail "Clara needs tar to extract the release."

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
  *) fail "Clara has no shell installer for $os. Download the release archive for your platform." ;;
esac

tmp=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/clara-install-$$")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

say "Clara installer for $platform"
curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 "$BASE_URL/manifest.json" -o "$tmp/manifest.json"
curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 "$BASE_URL/manifest.json.sig" -o "$tmp/manifest.json.sig"

if [ "$PUBLIC_KEY" != "__CLARA_RELEASE_PUBLIC_KEY__" ] && [ -n "$PUBLIC_KEY" ]; then
  command -v openssl >/dev/null 2>&1 || fail "Clara needs openssl to verify the release signature."
  {
    printf '%s\n' '-----BEGIN PUBLIC KEY-----'
    printf '%s\n' "$PUBLIC_KEY" | fold -w 64
    printf '%s\n' '-----END PUBLIC KEY-----'
  } > "$tmp/public.pem"
  base64 -d "$tmp/manifest.json.sig" > "$tmp/manifest.sig" 2>/dev/null || base64 --decode "$tmp/manifest.json.sig" > "$tmp/manifest.sig"
  openssl pkeyutl -verify -pubin -inkey "$tmp/public.pem" -rawin -in "$tmp/manifest.json" -sigfile "$tmp/manifest.sig" >/dev/null 2>&1 ||
    fail "The release signature did not match."
  say "Verified the release signature."
else
  say "warning: this installer was not built with a release public key; verifying the checksum only."
fi

if [ -z "$VERSION" ]; then
  VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp/manifest.json" | head -n 1)
fi
[ -n "$VERSION" ] || fail "Could not read the release version."

artifact=$(tr -d '\n' < "$tmp/manifest.json" | sed -n "s/.*\"$platform\"[[:space:]]*:[[:space:]]*{[^}]*\"url\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p")
sha=$(tr -d '\n' < "$tmp/manifest.json" | sed -n "s/.*\"$platform\"[[:space:]]*:[[:space:]]*{[^}]*\"sha256\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p")
[ -n "$artifact" ] || fail "The release has no build for $platform."
[ -n "$sha" ] || fail "The release has no checksum for $platform."

say "Downloading Clara $VERSION"
curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 300 "$artifact" -o "$tmp/clara.tar.gz"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/clara.tar.gz" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/clara.tar.gz" | awk '{print $1}')
else
  fail "Clara needs sha256sum or shasum to verify the download."
fi
[ "$actual" = "$sha" ] || fail "The download checksum did not match."

root="${CLARA_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/clara}/versions/$VERSION"
mkdir -p "$root"
tar -xzf "$tmp/clara.tar.gz" -C "$root"
chmod 755 "$root/clara"
mkdir -p "$BIN_DIR"
ln -sf "$root/clara" "$BIN_DIR/clara"

say "Installed Clara $VERSION to $root"
say "Linked $BIN_DIR/clara"
case ":$PATH:" in
  *":$BIN_DIR:"*) say "Run: clara setup" ;;
  *) say "Add $BIN_DIR to PATH, then run: clara setup" ;;
esac
