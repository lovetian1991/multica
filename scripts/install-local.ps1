# Multica CLI installer for Windows — unzip the package, run this, done.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# It installs the multica.exe sitting next to it, points the CLI at the server
# below, signs in, and starts the daemon. Paste an access token at the prompt
# to sign in without a browser; press Enter instead and the browser flow runs.
#
# Environment:
#   MULTICA_SERVER_URL        Override the built-in backend URL
#   MULTICA_APP_URL           Override the built-in web URL
#   MULTICA_BIN_DIR           Install directory (default: %USERPROFILE%\.multica\bin)
#   MULTICA_SKIP_PATH_UPDATE  Set to 1 to leave PATH untouched
#   MULTICA_SKIP_SETUP        Set to 1 to install the binary only
#   MULTICA_TOKEN             Sign in with this token instead of prompting

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Built-in deployment
#
# These two are the only values to change when the team moves servers; the
# token page URL is derived from the app URL. Both can be overridden for a
# single run by the matching environment variable.
# ---------------------------------------------------------------------------
$DefaultServerUrl = "http://192.168.11.173:30081"
$DefaultAppUrl    = "http://192.168.11.173:30080"

$ServerUrl = if ($env:MULTICA_SERVER_URL) { $env:MULTICA_SERVER_URL.TrimEnd('/') } else { $DefaultServerUrl }
$AppUrl    = if ($env:MULTICA_APP_URL) { $env:MULTICA_APP_URL.TrimEnd('/') } else { $DefaultAppUrl }
$TokenUrl  = "$AppUrl/settings?tab=tokens"

# Leaf directory the daemon creates (and the GC reclaims) task workspaces in,
# on whichever drive Select-WorkspacesRoot picks. Same leaf name as the CLI's
# built-in default ($HOME/multica_workspaces) so both layouts look alike.
$WorkspaceDirName = "multica_workspaces"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Warning $Msg }
function Write-Fail { param([string]$Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red; exit 1 }

function Test-CommandExists {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-ToUserPath {
    param([string]$Dir)

    if ($env:MULTICA_SKIP_PATH_UPDATE -eq "1") {
        Write-Info "Skipping PATH update (MULTICA_SKIP_PATH_UPDATE=1); add $Dir manually if needed."
        return
    }

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -and $currentPath.Split(";") -contains $Dir) {
        return
    }
    $newPath = if ($currentPath) { "$currentPath;$Dir" } else { $Dir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    if ($env:Path -notlike "*$Dir*") {
        $env:Path = "$Dir;$env:Path"
    }
    Write-Info "Added $Dir to user PATH (restart your terminal for other sessions to pick it up)."
}

# The freshly installed binary, called by absolute path: the PATH edit above is
# not visible to this process for a directory that did not exist before.
#
# The CLI prints human-facing status on stderr ("Daemon is not running.",
# "Authenticated as ...", "Found 1 workspace(s):") and reports failures through
# its exit code, which callers check. Windows PowerShell promotes the first
# stderr line of a native command to a terminating error while
# $ErrorActionPreference is "Stop" and that stderr is redirected (2>, *>),
# which aborted the install on the pre-start `daemon stop` of a machine that had
# no daemon yet. Relax the preference for the call, so redirecting stderr stays
# a way to hide chatter instead of a way to kill the installer.
function Invoke-Multica {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $ErrorActionPreference = "Continue"
    & $Dest @Arguments
    return $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Daemon workspace root
#
# Task workspaces are the bulk of what a daemon writes to disk, and the CLI's
# built-in root sits under $HOME - the system drive, which is rarely the roomiest
# one. Offer the fixed drive with the most free space, let the user take it or
# name another directory, and persist the answer with `multica config set
# workspaces_root`, so a daemon started later (from another shell, or by
# autostart) creates task workspaces in the same place.
# ---------------------------------------------------------------------------

# Ranks candidate drives and returns the workspace root on the winner, or $null
# when no fixed drive is usable.
function Select-WorkspacesRoot {
    param([object[]]$Drives)

    if (-not $Drives) { $Drives = [System.IO.DriveInfo]::GetDrives() }

    $best = $null
    foreach ($drive in $Drives) {
        # Removable and network drives come and go with the hardware and the
        # network: a task workspace has to outlive both, so only fixed disks
        # are candidates.
        if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { continue }
        try {
            if (-not $drive.IsReady) { continue }
            $free = [int64]$drive.AvailableFreeSpace
        } catch {
            continue  # unreadable drive: not a candidate, and not fatal
        }
        if ($null -eq $best -or $free -gt $best.Free) {
            $best = [pscustomobject]@{
                Path = Join-Path $drive.Name $WorkspaceDirName
                Free = $free
            }
        }
    }
    return $best
}

# Shows what the auto-selection found and returns the directory to use: the
# offer itself when the answer is empty, otherwise what the user typed. That
# answer is treated as the root verbatim - `workspaces_root` is the directory
# task workspaces go in, and someone who names one means it.
#
# Without a console there is nobody to ask, and Read-Host there blocks until the
# task is killed, so the offer stands. Callers decide that, from the same
# [Console]::IsInputRedirected signal the access-token prompt below uses.
function Read-WorkspacesRoot {
    param(
        [Parameter(Mandatory = $true)][object]$Default,
        [bool]$Interactive
    )

    if (-not $Interactive) {
        return $Default.Path
    }

    Write-Host "  Workspaces: $($Default.Path)" -NoNewline
    Write-Host (" (largest fixed drive, {0:N1} GB free)" -f ($Default.Free / 1GB)) -ForegroundColor DarkGray
    Write-Host "  Press Enter to accept, or paste another directory." -ForegroundColor DarkGray

    $answer = (Read-Host "  Workspace root").Trim()
    # Explorer's "Copy as path" pastes the directory wrapped in quotes.
    $answer = $answer.Trim('"').Trim()
    if (-not $answer) {
        return $Default.Path
    }
    return $answer
}

# Resolves the daemon workspace root and persists it, if this machine does not
# already have one. Called before the daemon starts so the daemon this
# installer launches uses the configured root from its first run.
function Initialize-WorkspacesRoot {
    param([bool]$Interactive = (-not [Console]::IsInputRedirected))

    if ($env:MULTICA_SKIP_SETUP -eq "1") {
        Write-Info "Skipping the daemon workspace root (MULTICA_SKIP_SETUP=1)."
        return
    }

    $configPath = Join-Path $env:USERPROFILE ".multica\config.json"
    $existing = $null
    if (Test-Path $configPath) {
        try { $existing = Get-Content -Raw -Path $configPath | ConvertFrom-Json } catch {}
    }

    if ($env:MULTICA_WORKSPACES_ROOT) {
        # An explicit override is already an answer, so there is nothing to ask.
        $root = $env:MULTICA_WORKSPACES_ROOT.Trim()
        $origin = "from MULTICA_WORKSPACES_ROOT"
    } elseif ($existing -and $existing.workspaces_root) {
        # Someone picked a root on this machine already - most likely an earlier
        # run of this installer, or a deliberate `config set`. Leave it alone.
        Write-Host "  Workspaces: $($existing.workspaces_root)" -NoNewline
        Write-Host " (already configured)" -ForegroundColor DarkGray
        return
    } else {
        $selected = Select-WorkspacesRoot
        if (-not $selected) {
            Write-Warn "No ready fixed drive to put the daemon workspace root on; leaving the built-in default."
            return
        }
        $root = Read-WorkspacesRoot -Default $selected -Interactive $Interactive
        if ($root -eq $selected.Path) {
            $origin = "largest fixed drive"
        } else {
            $origin = "chosen during install"
        }
    }

    if (-not $root) { return }

    # Create it now: a root the daemon cannot write to would only surface as
    # failing tasks later.
    try {
        New-Item -ItemType Directory -Path $root -Force -ErrorAction Stop | Out-Null
    } catch {
        Write-Warn "Could not create $root ($($_.Exception.Message)); leaving the built-in default."
        return
    }

    if ((Invoke-Multica config set workspaces_root $root) -ne 0) {
        Write-Warn "Could not save the workspace root; set it with 'multica config set workspaces_root <path>'."
        return
    }
    Write-Host "  Workspaces: $root" -NoNewline
    Write-Host " ($origin)" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Locate the binary that shipped in this package
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  Multica - Installer" -ForegroundColor White
Write-Host ""

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

$ExeSrc = Join-Path $ScriptDir "multica.exe"
if (-not (Test-Path $ExeSrc)) {
    # Tolerate the binary sitting one level down, which is what happens when
    # someone extracts with a wrapper folder and runs the installer from above.
    $found = Get-ChildItem -Path $ScriptDir -Filter "multica.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($found) {
        $ExeSrc = $found
    }
}
if (-not (Test-Path $ExeSrc)) {
    Write-Fail "multica.exe was not found next to this script ($ScriptDir).`n  Extract the whole package first, then run install.ps1 from the extracted folder."
}

$BinDir = if ($env:MULTICA_BIN_DIR) { $env:MULTICA_BIN_DIR } else { Join-Path $env:USERPROFILE ".multica\bin" }
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}
$Dest = Join-Path $BinDir "multica.exe"

function Copy-CliBinary {
    param([string]$Source, [string]$Destination)

    try {
        Copy-Item -Path $Source -Destination $Destination -Force -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

$daemonStopped = $false
if (-not (Copy-CliBinary $ExeSrc $Dest)) {
    # Windows refuses to replace a running executable, and a live daemon holds
    # multica.exe open. Stop it and retry rather than making the user guess.
    if (Test-CommandExists "multica") {
        Write-Info "A running daemon is holding $Dest - stopping it and retrying..."
        try { multica daemon stop *>$null } catch {}
        Start-Sleep -Milliseconds 500
        $daemonStopped = $true
    }

    if (-not (Copy-CliBinary $ExeSrc $Dest)) {
        Write-Fail "Could not replace $Dest. Close any process using it and re-run this installer."
    }
}

Add-ToUserPath $BinDir

$version = "unknown"
try { $version = (Invoke-Multica version | Select-Object -First 1) } catch {}

Write-Host ""
Write-Ok "Multica CLI installed to $Dest"
Write-Host "  Version: $version"

# ---------------------------------------------------------------------------
# Configure, sign in, start the daemon
# ---------------------------------------------------------------------------
function Start-MulticaDaemon {
    Write-Info "Starting the daemon..."
    # A daemon may still be running from a previous install, holding the old
    # server URL and token; stop it so the new credentials are what actually
    # runs. Stopping a daemon that is not running is an error we ignore.
    Invoke-Multica daemon stop *>$null | Out-Null
    if ((Invoke-Multica daemon start) -ne 0) {
        Write-Warn "Could not start the daemon. Start it later with 'multica daemon start'."
        return
    }
    Write-Ok "Daemon started"
}

$script:SignInFailed = $false

function Initialize-Multica {
    if ($env:MULTICA_SKIP_SETUP -eq "1") {
        Write-Info "Skipping configuration (MULTICA_SKIP_SETUP=1)."
        return
    }

    $configPath = Join-Path $env:USERPROFILE ".multica\config.json"
    if (Test-Path $configPath) {
        $existing = $null
        try { $existing = Get-Content -Raw -Path $configPath | ConvertFrom-Json } catch {}
        if ($existing -and $existing.server_url -eq $ServerUrl) {
            Write-Host ""
            Write-Host "  This machine is already configured for $ServerUrl."
            # [Environment]::UserInteractive stays true even with no console
            # attached (scheduled tasks, CI), where Read-Host would block
            # forever. Redirected stdin is the honest signal.
            $reconfigure = $false
            if (-not [Console]::IsInputRedirected) {
                $answer = Read-Host "  Reconfigure it (new token or browser sign-in)? [y/N]"
                $reconfigure = $answer -match '^(?i)\s*y'
            }
            if (-not $reconfigure) {
                Write-Info "Keeping the existing configuration."
                return
            }
        }
    }

    Write-Host ""
    Write-Info "Configuring this machine"
    Write-Host "  Server: $ServerUrl"
    Write-Host "  App:    $AppUrl"
    Initialize-WorkspacesRoot
    Write-Host ""
    Write-Host "  Access tokens are created under Settings > API Tokens:" -ForegroundColor DarkGray
    Write-Host "    $TokenUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Paste a token to sign in without a browser," -ForegroundColor DarkGray
    Write-Host "  or press Enter to sign in through your browser." -ForegroundColor DarkGray
    Write-Host ""

    $token = ""
    if ($env:MULTICA_TOKEN) {
        $token = $env:MULTICA_TOKEN.Trim()
        Write-Info "Using the token from MULTICA_TOKEN."
    } elseif (-not [Console]::IsInputRedirected) {
        $token = (Read-Host "  Access token (optional)").Trim()
    } else {
        Write-Warn "No interactive console detected - signing in through the browser instead."
        Write-Warn "Set MULTICA_TOKEN to sign in non-interactively."
    }

    Invoke-Multica config set server_url $ServerUrl | Out-Null
    Invoke-Multica config set app_url $AppUrl | Out-Null

    if ($token) {
        Write-Info "Signing in with the access token..."
        if ((Invoke-Multica login --token $token) -ne 0) {
            Write-Warn "Sign-in failed. Run 'multica login --token <token>' to retry."
            $script:SignInFailed = $true
            return
        }
    } else {
        Write-Info "Signing in through the browser..."
        if ((Invoke-Multica login) -ne 0) {
            Write-Warn "Sign-in failed. Run 'multica login' to retry."
            $script:SignInFailed = $true
            return
        }
    }

    Start-MulticaDaemon
}

Initialize-Multica

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "  [OK] Multica CLI is ready!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to: $Dest"
Write-Host "  Version:      $version"
Write-Host "  Server:       $ServerUrl"
Write-Host ""

if ($daemonStopped) {
    Write-Host "  The daemon was stopped during the upgrade and restarted above."
    Write-Host ""
}

if (-not (Test-CommandExists "multica")) {
    Write-Warn "Restart your terminal so the updated PATH picks up 'multica'."
}

if ($script:SignInFailed) {
    Write-Warn "Sign-in did not complete - this machine cannot run agents yet."
    Write-Warn "Run 'multica login' once you have a token, then 'multica daemon start'."
    Write-Host ""
}

Write-Host "  Useful commands"
Write-Host ""
Write-Host "     multica daemon status       " -NoNewline; Write-Host "# Is the daemon running?" -ForegroundColor DarkGray
Write-Host "     multica daemon logs -f      " -NoNewline; Write-Host "# Follow daemon logs" -ForegroundColor DarkGray
Write-Host "     multica auth status         " -NoNewline; Write-Host "# Who am I signed in as?" -ForegroundColor DarkGray
Write-Host ""
