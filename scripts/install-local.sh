#!/usr/bin/env bash
# Multica CLI installer for macOS/Linux — unzip the package, run this, done.
#
#   sh ./install.sh
#
# It installs the multica binary sitting next to it, points the CLI at the
# server below, signs in, and starts the daemon. Paste an access token at the
# prompt to sign in without a browser; press Enter instead and the browser
# flow runs.
#
# Environment:
#   MULTICA_SERVER_URL        Override the built-in backend URL
#   MULTICA_APP_URL           Override the built-in web URL
#   MULTICA_BIN_DIR           Install directory (default: /usr/local/bin, then ~/.local/bin)
#   MULTICA_SKIP_PATH_UPDATE  Set to 1 to leave shell rc files untouched
#   MULTICA_SKIP_SETUP        Set to 1 to install the binary only
#   MULTICA_TOKEN             Sign in with this token instead of prompting
set -euo pipefail

# ---------------------------------------------------------------------------
# Built-in deployment
#
# These two are the only values to change when the team moves servers; the
# token page URL is derived from the app URL. Both can be overridden for a
# single run by the matching environment variable.
# ---------------------------------------------------------------------------
DEFAULT_SERVER_URL="http://192.168.11.173:30081"
DEFAULT_APP_URL="http://192.168.11.173:30080"

SERVER_URL="${MULTICA_SERVER_URL:-$DEFAULT_SERVER_URL}"
APP_URL="${MULTICA_APP_URL:-$DEFAULT_APP_URL}"
SERVER_URL="${SERVER_URL%/}"
APP_URL="${APP_URL%/}"
TOKEN_URL="$APP_URL/settings?tab=tokens"

BOLD='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
if [ -t 1 ] || [ -t 2 ]; then
  BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
fi

info() { printf "${BOLD}${CYAN}==> %s${RESET}\n" "$*"; }
ok()   { printf "${BOLD}${GREEN}✓ %s${RESET}\n" "$*"; }
warn() { printf "${BOLD}${YELLOW}⚠ %s${RESET}\n" "$*" >&2; }
fail() { printf "${BOLD}${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

add_to_path() {
  local dir="$1" rc

  if [ "${MULTICA_SKIP_PATH_UPDATE:-}" = "1" ]; then
    info "Skipping PATH update (MULTICA_SKIP_PATH_UPDATE=1); add $dir manually if needed."
    return
  fi

  case ":$PATH:" in
    *":$dir:"*) return ;;
  esac
  export PATH="$dir:$PATH"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && ! grep -qF "$dir" "$rc"; then
      printf '\n# Added by Multica installer\n%s\n' "export PATH=\"$dir:\$PATH\"" >>"$rc"
    fi
  done
  warn "$dir was added to PATH — restart your shell for other sessions to pick it up."
}

# ---------------------------------------------------------------------------
# Locate the binary that shipped in this package
# ---------------------------------------------------------------------------
printf "\n"
printf "${BOLD}  Multica — Installer${RESET}\n"
printf "\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SRC="$SCRIPT_DIR/multica"
if [ ! -f "$SRC" ]; then
  # Tolerate the binary sitting one level down, which is what happens when
  # someone extracts with a wrapper folder and runs the installer from above.
  SRC="$(find "$SCRIPT_DIR" -maxdepth 2 -name multica -type f -print -quit 2>/dev/null || true)"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  fail "multica was not found next to this script ($SCRIPT_DIR).
  Extract the whole package first, then run install.sh from the extracted folder."
fi

BIN_DIR="${MULTICA_BIN_DIR:-/usr/local/bin}"
if [ ! -d "$BIN_DIR" ]; then
  mkdir -p "$BIN_DIR" 2>/dev/null || true
fi

if [ -w "$BIN_DIR" ]; then
  install -m 0755 "$SRC" "$BIN_DIR/multica"
elif command_exists sudo; then
  info "Installing to $BIN_DIR (needs sudo)"
  sudo install -m 0755 "$SRC" "$BIN_DIR/multica" || fail "Failed to install to $BIN_DIR"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  install -m 0755 "$SRC" "$BIN_DIR/multica"
fi

add_to_path "$BIN_DIR"

# The freshly installed binary, called by absolute path: the PATH edit above is
# not visible to this process for a directory that was not on it before.
BIN="$BIN_DIR/multica"

VERSION="$("$BIN" version 2>/dev/null | head -1 || echo unknown)"
printf "\n"
ok "Multica CLI installed to $BIN"
printf "  Version: %s\n" "$VERSION"

# ---------------------------------------------------------------------------
# Configure, sign in, start the daemon
# ---------------------------------------------------------------------------
SIGN_IN_FAILED=0

start_daemon() {
  info "Starting the daemon..."
  # A daemon may still be running from a previous install, holding the old
  # server URL and token; stop it so the new credentials are what actually
  # runs. Stopping a daemon that is not running is an error we ignore.
  "$BIN" daemon stop >/dev/null 2>&1 || true
  if ! "$BIN" daemon start; then
    warn "Could not start the daemon. Start it later with 'multica daemon start'."
    return
  fi
  ok "Daemon started"
}

configure_multica() {
  if [ "${MULTICA_SKIP_SETUP:-}" = "1" ]; then
    info "Skipping configuration (MULTICA_SKIP_SETUP=1)."
    return
  fi

  local config="$HOME/.multica/config.json"
  if [ -f "$config" ] && grep -qF "$SERVER_URL" "$config"; then
    printf "\n  This machine is already configured for %s.\n" "$SERVER_URL"
    if [ -t 0 ]; then
      printf "  Reconfigure it (new token or browser sign-in)? [y/N] "
      local answer=""
      read -r answer || answer=""
      case "$answer" in
        [yY]*) ;;
        *) info "Keeping the existing configuration."; return ;;
      esac
    else
      info "Keeping the existing configuration."
      return
    fi
  fi

  printf "\n"
  info "Configuring this machine"
  printf "  Server: %s\n" "$SERVER_URL"
  printf "  App:    %s\n" "$APP_URL"
  printf "\n  Access tokens are created under Settings > API Tokens:\n"
  printf "    %s\n" "$TOKEN_URL"
  printf "\n  Paste a token to sign in without a browser,\n"
  printf "  or press Enter to sign in through your browser.\n\n"

  local token=""
  if [ -n "${MULTICA_TOKEN:-}" ]; then
    token="$MULTICA_TOKEN"
    info "Using the token from MULTICA_TOKEN."
  elif [ -t 0 ]; then
    printf "  Access token (optional): "
    read -r token || token=""
  else
    warn "No interactive terminal detected - falling back to browser sign-in."
  fi
  token="$(printf '%s' "$token" | tr -d '[:space:]')"

  "$BIN" config set server_url "$SERVER_URL" >/dev/null
  "$BIN" config set app_url "$APP_URL" >/dev/null

  if [ -n "$token" ]; then
    info "Signing in with the access token..."
    if ! "$BIN" login --token "$token"; then
      warn "Sign-in failed. Run 'multica login --token <token>' to retry."
      SIGN_IN_FAILED=1
      return
    fi
  else
    info "Signing in through the browser..."
    if ! "$BIN" login; then
      warn "Sign-in failed. Run 'multica login' to retry."
      SIGN_IN_FAILED=1
      return
    fi
  fi

  start_daemon
}

configure_multica

printf "\n"
printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "${BOLD}${GREEN}  ✓ Multica CLI is ready!${RESET}\n"
printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
printf "\n"
printf "  Installed to: %s\n" "$BIN"
printf "  Version:      %s\n" "$VERSION"
printf "  Server:       %s\n" "$SERVER_URL"
if [ "$SIGN_IN_FAILED" = "1" ]; then
  warn "Sign-in did not complete — this machine cannot run agents yet."
  warn "Run 'multica login' once you have a token, then 'multica daemon start'."
fi

printf "\n"
printf "  ${BOLD}Useful commands${RESET}\n"
printf "\n"
printf "     %smultica daemon status%s    # Is the daemon running?\n" "$CYAN" "$RESET"
printf "     %smultica daemon logs -f%s   # Follow daemon logs\n" "$CYAN" "$RESET"
printf "     %smultica auth status%s      # Who am I signed in as?\n" "$CYAN" "$RESET"
printf "\n"
