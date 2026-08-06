#Requires -Version 5.1
<#
  setup-windows.ps1 — Balatro MCP: Windows install/build/doctor helper.

  Replaces the macOS Makefile targets on Windows:
    .\scripts\setup-windows.ps1 doctor        Check paths & tools
    .\scripts\setup-windows.ps1 install-mods  Copy repo mods -> %APPDATA%\Balatro\Mods
    .\scripts\setup-windows.ps1 build         Build the MCP server (pnpm)
    .\scripts\setup-windows.ps1 all          install-mods + build

  Overrides (optional):
    -ModsDir    Balatro mods directory (default: %APPDATA%\Balatro\Mods)
    -BalatroDir Balatro game directory (default: auto-detect via Steam)
    -Port       Bridge TCP port (default: 37651, matches the Lua default). This
              is informational for doctor; to actually change the port, set the
              BALATRO_BRIDGE_PORT env var before launching Balatro and the MCP
              server (both the mod and the server read it).
#>
param(
  [ValidateSet('doctor','install-mods','build','all')]
  [string]$Command = 'doctor',

  [string]$ModsDir,
  [string]$BalatroDir,
  [string]$Port = '37651'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$RepoMods = Join-Path $Root 'mods'
$MCPDir = Join-Path $Root 'mcp'

if (-not $ModsDir) {
  $ModsDir = Join-Path $env:APPDATA 'Balatro\Mods'
}

function Get-BalatroDir {
  # 1) Common hard-coded Steam locations
  $candidates = @(
    'C:\Program Files (x86)\Steam\steamapps\common\Balatro',
    'C:\Program Files\Steam\steamapps\common\Balatro',
    (Join-Path $env:ProgramFiles 'Steam\steamapps\common\Balatro'),
    (Join-Path ${env:ProgramFiles(x86)} 'Steam\steamapps\common\Balatro')
  )

  # 2) Additional library folders from Steam's libraryfolders.vdf
  $vdfPaths = @(
    'C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf',
    'C:\Program Files\Steam\steamapps\libraryfolders.vdf',
    (Join-Path $env:ProgramFiles 'Steam\steamapps\libraryfolders.vdf'),
    (Join-Path ${env:ProgramFiles(x86)} 'Steam\steamapps\libraryfolders.vdf'),
    'D:\Steam\steamapps\libraryfolders.vdf',
    'E:\Steam\steamapps\libraryfolders.vdf',
    'F:\Steam\steamapps\libraryfolders.vdf'
  )
  foreach ($vdf in $vdfPaths) {
    if (Test-Path $vdf) {
      # Extract "path" entries from libraryfolders.vdf
      $paths = Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' |
        ForEach-Object { $_.Matches[0].Groups[1].Value }
      foreach ($p in $paths) {
        $candidates += (Join-Path $p 'steamapps\common\Balatro')
      }
    }
  }

  foreach ($c in ($candidates | Select-Object -Unique)) {
    if ($c -and (Test-Path (Join-Path $c 'Balatro.exe'))) { return $c }
  }
  return $null
}

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ERROR: $msg" -ForegroundColor Red }

function Test-Tool([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Invoke-Doctor {
  Write-Step "Balatro MCP - Windows environment check"
  Write-Host "  Repo: $Root"

  if (-not $BalatroDir) { $BalatroDir = Get-BalatroDir }
  if ($BalatroDir -and (Test-Path $BalatroDir)) {
    Write-Ok "Balatro game dir: $BalatroDir"
  } else {
    Write-Warn "Balatro game dir not detected. Pass -BalatroDir on Steam download."
  }

  if (Test-Path $ModsDir) {
    Write-Ok "Mods dir exists: $ModsDir"
  } else {
    Write-Warn "Mods dir missing (game not run yet): $ModsDir"
  }

  if (Test-Tool 'node') { Write-Ok "node $(node --version)" } else { Write-Err "node not found" }
  if (Test-Tool 'pnpm') { Write-Ok "pnpm $(pnpm --version)" } else { Write-Err "pnpm not found" }
  if (Test-Tool 'luac') { Write-Ok "luac available" } else { Write-Warn "luac not found (Lua syntax check skipped)" }

  Write-Host "  Bridge port: $Port"
}

function Invoke-InstallMods {
  Write-Step "Installing repo mods -> $ModsDir"
  if (-not (Test-Path $RepoMods)) { Write-Err "repo mods dir missing: $RepoMods"; exit 1 }
  New-Item -ItemType Directory -Force -Path $ModsDir | Out-Null

  $installed = 0
  Get-ChildItem -Path $RepoMods -Directory | ForEach-Object {
    $name = $_.Name
    if ($name -eq 'smods') { Write-Warn "Skipping reserved mod name: smods"; return }
    $dst = Join-Path $ModsDir $name
    Write-Host "  syncing $name -> $dst"
    # Remove stale destination entirely, then copy fresh (preserves subdirs like src/)
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $_.FullName '*') -Destination $dst -Recurse -Force
    $installed++
  }

  if ($installed -eq 0) { Write-Warn "No mods installed from $RepoMods" }
  else { Write-Ok "Installed $installed mod(s). Restart Balatro to load." }
}

function Invoke-Build {
  Write-Step "Building MCP server"
  if (-not (Test-Path (Join-Path $MCPDir 'package.json'))) { Write-Err "mcp/package.json missing"; exit 1 }
  Push-Location $MCPDir
  try {
    if (-not (Test-Path (Join-Path $MCPDir 'node_modules'))) { Write-Host "  pnpm install..."; pnpm install }
    Write-Host "  pnpm build..."
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
  Write-Ok "MCP server built at $MCPDir/dist/index.js"
}

switch ($Command) {
  'doctor'       { Invoke-Doctor }
  'install-mods' { Invoke-InstallMods }
  'build'        { Invoke-Build }
  'all'          { Invoke-InstallMods; Invoke-Build }
}

Write-Host "`nDone."