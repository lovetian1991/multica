#!/usr/bin/env bash
# Build self-contained Multica CLI packages for internal distribution.
#
# Each package is a zip holding both the platform binary and the installer
# that puts it on PATH, so handing over the zip is the whole distribution:
#
#   multica-windows-amd64.zip
#     multica.exe
#     install.ps1
#
# Version choice matters when the package reaches a daemon that can also see
# GitHub: the daemon self-updates only when its version looks like a tagged
# release (cli.IsReleaseVersion, server/internal/cli/update.go). The default
# 0.0.0-dev therefore never gets replaced by an official release.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"

VERSION=""
OSES="windows,linux,darwin"
ARCHES="amd64,arm64"
OUT_DIR="$ROOT_DIR/dist-cli"

usage() {
  cat <<'USAGE'
Usage: bash scripts/package-cli.sh [options]

  --version <v>   Version to embed. Default: the tag when HEAD is exactly on
                  one, otherwise 0.0.0-dev (which never self-updates away).
  --os <list>     Comma-separated GOOS values   (default: windows,linux,darwin)
  --arch <list>   Comma-separated GOARCH values (default: amd64,arm64)
  --out <dir>     Output directory              (default: <repo>/dist-cli)
  -h, --help      Show this help.

Examples:
  bash scripts/package-cli.sh --os windows --arch amd64
  bash scripts/package-cli.sh --version 0.0.0-dev-6ec7c29d8
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --os)      OSES="${2:?--os needs a value}"; shift 2 ;;
    --arch)    ARCHES="${2:?--arch needs a value}"; shift 2 ;;
    --out)     OUT_DIR="${2:?--out needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

case "$OUT_DIR" in
  ""|"/"|"."|"..") echo "error: refusing to use '$OUT_DIR' as the output directory" >&2; exit 1 ;;
esac

if ! command -v go >/dev/null 2>&1; then
  echo "error: the Go toolchain is not on PATH. Install Go or add its bin directory, then re-run." >&2
  exit 1
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Git Bash hands `go` and `powershell.exe` an MSYS path they cannot resolve;
# every other platform wants the path as-is.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

# Only a tag without extra git-describe decoration is a version the daemon
# would treat as a release, so anything else falls back to a dev version rather
# than copying an upstream release number it does not match.
resolve_version() {
  if [ -n "$VERSION" ]; then
    printf '%s' "${VERSION#v}"
    return
  fi

  local described
  described="$(git -C "$ROOT_DIR" describe --tags --dirty 2>/dev/null || true)"
  if [[ "$described" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi

  printf '0.0.0-dev'
}

make_zip() {
  local stage="$1" dest="$2"

  if command -v zip >/dev/null 2>&1; then
    ( cd "$stage" && zip -q -r "$dest" . )
    return
  fi

  # Git Bash ships tar and unzip but not zip; Windows already has this.
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command \
      "Compress-Archive -Path '$(native_path "$stage")\\*' -DestinationPath '$(native_path "$dest")' -Force"
    return
  fi

  echo "error: need either 'zip' or 'powershell.exe' to build the packages" >&2
  exit 1
}

# Unzip must yield the binary and the installer at the archive root, because
# the installer looks for the binary beside itself.
verify_zip() {
  local archive="$1"
  shift

  command -v unzip >/dev/null 2>&1 || return

  local listing member
  listing="$(unzip -Z1 "$archive")"
  for member in "$@"; do
    if ! printf '%s\n' "$listing" | grep -qx "$member"; then
      echo "error: $archive is missing a root-level $member" >&2
      exit 1
    fi
  done
}

package_one() {
  local os="$1" arch="$2" bin installer stage name

  if [ "$os" = "windows" ]; then
    bin="multica.exe"; installer="install-local.ps1"
  else
    bin="multica"; installer="install-local.sh"
  fi

  echo "==> building $os/$arch"
  stage="$(mktemp -d)"

  ( cd "$SERVER_DIR" && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
      go build -trimpath -ldflags "$LDFLAGS" -o "$(native_path "$stage/$bin")" ./cmd/multica )

  # The installer travels inside the package and is named for the person who
  # opens the zip, not for its place in this repo.
  if [ "$os" = "windows" ]; then
    cp "$ROOT_DIR/scripts/$installer" "$stage/install.ps1"
  else
    cp "$ROOT_DIR/scripts/$installer" "$stage/install.sh"
  fi

  name="multica-${os}-${arch}.zip"
  make_zip "$stage" "$OUT_DIR/$name"
  rm -rf "$stage"

  if [ "$os" = "windows" ]; then
    verify_zip "$OUT_DIR/$name" "multica.exe" "install.ps1"
  else
    verify_zip "$OUT_DIR/$name" "multica" "install.sh"
  fi

  echo "    $name"
}

generate_checksums() {
  local f name
  : >"$OUT_DIR/checksums.txt"
  for f in "$OUT_DIR"/*; do
    name="$(basename "$f")"
    case "$name" in
      checksums.txt) continue ;;
    esac
    printf '%s  %s\n' "$(sha256_of "$f")" "$name" >>"$OUT_DIR/checksums.txt"
  done
}

VERSION="$(resolve_version)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Same ldflags GoReleaser injects, minus the release-only variables.
LDFLAGS="-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE"

if [ -d "$OUT_DIR" ]; then
  echo "==> clearing $OUT_DIR"
  rm -rf "$OUT_DIR"
fi
mkdir -p "$OUT_DIR"

IFS=',' read -r -a os_list <<<"$OSES"
IFS=',' read -r -a arch_list <<<"$ARCHES"

for os in "${os_list[@]}"; do
  for arch in "${arch_list[@]}"; do
    package_one "$os" "$arch"
  done
done

echo "==> checksums"
generate_checksums

echo ""
echo "Multica CLI $VERSION packaged into $OUT_DIR:"
ls -1 "$OUT_DIR"
echo ""
echo "Hand a colleague the zip for their platform; it carries its own installer:"
echo "  Windows:      multica.exe + install.ps1"
echo "                powershell -ExecutionPolicy Bypass -File .\\install.ps1"
echo "  macOS/Linux:  multica + install.sh"
echo "                sh ./install.sh"
