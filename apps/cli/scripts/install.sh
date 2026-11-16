#!/bin/sh
# Clara installer.
#
#   curl -fsSL https://clara.kalenmichael.com/install | sh
#   curl -fsSL https://clara.kalenmichael.com/install | sh -s -- --no-desktop
#
# Downloads the signed release manifest, verifies it, installs the matching
# command archive under ~/.local/share/clara/versions, links `clara` into
# ~/.local/bin, and installs the Clara desktop app when this machine has a GUI.
set -eu

BASE_URL="${CLARA_RELEASE_BASE_URL:-__CLARA_RELEASE_BASE_URL__}"
BASE_URL_EXPLICIT=0
if [ -n "${CLARA_RELEASE_BASE_URL:-}" ]; then BASE_URL_EXPLICIT=1; fi
FALLBACK_BASE_URL='https://github.com/kalenmike/clara/releases/latest/download'
REQUESTED_VERSION=""
BIN_DIR="${CLARA_BIN_DIR:-$HOME/.local/bin}"
PUBLIC_KEY='__CLARA_RELEASE_PUBLIC_KEY__'
DESKTOP_MODE="${CLARA_INSTALL_DESKTOP:-auto}"
if [ "${CLARA_NO_DESKTOP:-}" = "1" ]; then DESKTOP_MODE='no'; fi

say() { printf '%s\n' "$*"; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) REQUESTED_VERSION="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; BASE_URL_EXPLICIT=1; shift 2 ;;
    --bin-dir) BIN_DIR="${2:-}"; shift 2 ;;
    --desktop) DESKTOP_MODE='yes'; shift ;;
    --no-desktop) DESKTOP_MODE='no'; shift ;;
    -h|--help)
      say "Usage: install.sh [--version <v>] [--base-url <url>] [--bin-dir <dir>] [--desktop|--no-desktop]"
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

BASE_URL="${BASE_URL%/}"
command -v curl >/dev/null 2>&1 || fail "Clara needs curl to download the release."
command -v tar >/dev/null 2>&1 || fail "Clara needs tar to extract the release."
command -v awk >/dev/null 2>&1 || fail "Clara needs awk to read the release manifest."

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

if [ "$DESKTOP_MODE" = 'auto' ]; then
  case "$os" in
    Darwin) DESKTOP_MODE='yes' ;;
    Linux)
      if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then DESKTOP_MODE='yes'; else DESKTOP_MODE='no'; fi
      ;;
    *) DESKTOP_MODE='no' ;;
  esac
fi
case "$DESKTOP_MODE" in
  yes | always | 1) DESKTOP_MODE='yes' ;;
  no | never | 0) DESKTOP_MODE='no' ;;
  *) fail "CLARA_INSTALL_DESKTOP must be auto, yes, or no." ;;
esac

tmp=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/clara-install-$$")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

fetch_manifest() {
  curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 \
    "$1/manifest.json" -o "$tmp/manifest.json" || return 1
  curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 \
    "$1/manifest.json.sig" -o "$tmp/manifest.json.sig" || return 1
  return 0
}

say "Clara installer for $platform"
if ! fetch_manifest "$BASE_URL"; then
  if [ "$BASE_URL_EXPLICIT" = "1" ] || [ "$BASE_URL" = "$FALLBACK_BASE_URL" ]; then
    fail "Could not read the Clara release manifest from $BASE_URL."
  fi
  say "The registry is unavailable; using the GitHub release."
  BASE_URL="$FALLBACK_BASE_URL"
  fetch_manifest "$BASE_URL" || fail "Could not read the Clara release manifest."
fi

verify_signature() {
  if [ "$PUBLIC_KEY" = "__CLARA_RELEASE_PUBLIC_KEY__" ] || [ -z "$PUBLIC_KEY" ]; then
    if [ "${CLARA_REQUIRE_SIGNATURE:-}" = "1" ]; then
      fail "This installer was not built with a release public key."
    fi
    say "warning: this installer was not built with a release public key; verifying the checksum only."
    return 0
  fi

  verifier=''
  for candidate in /opt/homebrew/bin/openssl /usr/local/bin/openssl openssl; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    case "$("$candidate" version 2>/dev/null || true)" in *LibreSSL*) continue ;; esac
    if "$candidate" pkeyutl -help 2>&1 | grep -q 'rawin'; then
      verifier="$candidate"
      break
    fi
  done

  if [ -z "$verifier" ]; then
    if [ "${CLARA_REQUIRE_SIGNATURE:-}" = "1" ]; then
      fail "Clara needs an Ed25519-capable openssl to verify this release."
    fi
    say "warning: no Ed25519-capable openssl found; verifying the checksum only."
    return 0
  fi

  {
    printf '%s\n' '-----BEGIN PUBLIC KEY-----'
    printf '%s\n' "$PUBLIC_KEY" | fold -w 64
    printf '%s\n' '-----END PUBLIC KEY-----'
  } > "$tmp/public.pem"
  if ! base64 -d "$tmp/manifest.json.sig" > "$tmp/manifest.sig" 2>/dev/null; then
    if ! base64 -D "$tmp/manifest.json.sig" > "$tmp/manifest.sig" 2>/dev/null; then
      "$verifier" base64 -d -A -in "$tmp/manifest.json.sig" -out "$tmp/manifest.sig" ||
        fail "Could not decode the release signature."
    fi
  fi
  "$verifier" pkeyutl -verify -pubin -inkey "$tmp/public.pem" -rawin \
    -in "$tmp/manifest.json" -sigfile "$tmp/manifest.sig" >/dev/null 2>&1 ||
    fail "The release signature did not match."
  say "Verified the release signature."
}

verify_signature

cli_manifest=$(awk '
  /^  "cli": \{/ { inside = 1 }
  inside { print }
  inside && /^  \}[,]?$/ { exit }
' "$tmp/manifest.json")
[ -n "$cli_manifest" ] || fail "The release manifest has no CLI section."

flat=$(printf '%s' "$cli_manifest" | tr -d '\n')
artifact=$(printf '%s' "$flat" | sed -n "s/.*\"$platform\"[[:space:]]*:[[:space:]]*{[^}]*\"url\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p")
sha=$(printf '%s' "$flat" | sed -n "s/.*\"$platform\"[[:space:]]*:[[:space:]]*{[^}]*\"sha256\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p")
[ -n "$artifact" ] || fail "The release has no build for $platform."
[ -n "$sha" ] || fail "The release has no checksum for $platform."

say "Downloading Clara"
curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 300 "$artifact" -o "$tmp/clara.tar.gz"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/clara.tar.gz" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/clara.tar.gz" | awk '{print $1}')
else
  fail "Clara needs sha256sum or shasum to verify the download."
fi
[ "$actual" = "$sha" ] || fail "The download checksum did not match."

mkdir -p "$tmp/unpack"
tar -xzf "$tmp/clara.tar.gz" -C "$tmp/unpack"
chmod 755 "$tmp/unpack/clara"
version_output=$("$tmp/unpack/clara" --version 2>/dev/null) ||
  fail "The downloaded Clara binary could not run on this machine."
VERSION=$(printf '%s\n' "$version_output" | sed -n 's/^\([0-9][0-9A-Za-z.+-]*\).*/\1/p' | head -n 1)
if [ -z "$VERSION" ]; then
  VERSION=$(printf '%s' "$cli_manifest" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ -n "$VERSION" ] || fail "Could not read the release version."
if [ -n "$REQUESTED_VERSION" ] && [ "$REQUESTED_VERSION" != "$VERSION" ]; then
  fail "The release contains Clara $VERSION, not $REQUESTED_VERSION."
fi

root="${CLARA_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/clara}/versions/$VERSION"
mkdir -p "$root"
cp "$tmp/unpack/clara" "$root/clara"
chmod 755 "$root/clara"
mkdir -p "$BIN_DIR"
ln -sf "$root/clara" "$BIN_DIR/clara"

say "Installed Clara $VERSION to $root"
say "Linked $BIN_DIR/clara"

if [ "$DESKTOP_MODE" = 'yes' ]; then
  say "Installing the Clara desktop app"
  if "$BIN_DIR/clara" desktop install --base-url "$BASE_URL" --bin-dir "$BIN_DIR" --optional; then
    :
  else
    say "warning: the desktop app was not installed. Run \`clara desktop install\` later."
  fi
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) say "Run: clara setup" ;;
  *) say "Add $BIN_DIR to PATH, then run: clara setup" ;;
esac
