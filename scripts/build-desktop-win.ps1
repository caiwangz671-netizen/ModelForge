param(
  [string]$BackendPort = '18000',
  [string]$ElectronArch = 'x64',
  [switch]$SkipDepInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RootDir 'frontend'
$BackendDir = Join-Path $RootDir 'backend'
$DesktopDir = Join-Path $RootDir 'desktop'
$ReleaseDir = Join-Path $RootDir 'release'
$DesktopPayloadFrontendDir = Join-Path $DesktopDir 'frontend-dist'
$DesktopPayloadBackendDir = Join-Path $DesktopDir 'backend-bin'
$BackendVenvDir = Join-Path $BackendDir 'venv'
$BackendVenvPython = Join-Path $BackendVenvDir 'Scripts/python.exe'
$BackendVenvPip = Join-Path $BackendVenvDir 'Scripts/pip.exe'
$ElectronBuilderVersion = '26.0.12'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Log {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Get-PackageMetadata {
  $path = Join-Path $DesktopDir "package.json"
  if (-not (Test-Path $path)) {
    return @{ name = "modelforge"; version = "0.0.0" }
  }

  try {
    # Using Raw and UTF8 to handle potential BOM issues in different PS versions
    $json = Get-Content -Path $path -Raw -Encoding UTF8
    # Strip basic comments if they exist
    $json = $json -replace "(?m)^\s*//.*", ""
    return $json | ConvertFrom-Json
  } catch {
    Write-Warning "Failed to parse package.json natively: $($_.Exception.Message)"
    # Fallback to simple regex if JSON parsing fails on older PS versions or non-compliant files
    $json = Get-Content -Path $path -Raw
    $version = "0.0.0"
    $name = "modelforge"
    if ($json -match '"version":\s*"([^"]+)"') { $version = $matches[1] }
    if ($json -match '"name":\s*"([^"]+)"') { $name = $matches[1] }
    return @{ name = $name; version = $version }
  }
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Invoke-NpmInstall {
  param(
    [string]$WorkingDirectory,
    [bool]$OmitOptional = $false
  )

  $arguments = @('install', '--no-audit', '--progress=false')
  if ($OmitOptional) {
    $arguments += '--omit=optional'
  }

  Push-Location $WorkingDirectory
  try {
    & npm.cmd @arguments
  } finally {
    Pop-Location
  }
}

function Remove-PathIfExists {
  param([string]$TargetPath)
  if (Test-Path $TargetPath) {
    Remove-Item $TargetPath -Recurse -Force
  }
}

function Resolve-PythonLauncher {
  $candidates = @(
    @{ Command = 'python'; Arguments = @() },
    @{ Command = 'py'; Arguments = @('-3') }
  )

  foreach ($candidate in $candidates) {
    if (Get-Command $candidate.Command -ErrorAction SilentlyContinue) {
      return $candidate
    }
  }

  throw 'Missing required command: python or py'
}

function Resolve-BuilderArchArgument {
  param([string]$Arch)

  $normalizedArch = ''
  if ($null -ne $Arch) {
    $normalizedArch = $Arch.ToLowerInvariant()
  }

  switch ($normalizedArch) {
    'x64' { return '--x64' }
    'arm64' { return '--arm64' }
    'ia32' { return '--ia32' }
    default { throw "Unsupported Windows Electron architecture: $Arch" }
  }
}

function Ensure-BackendVenv {
  if (-not (Test-Path $BackendVenvPython) -or -not (Test-Path $BackendVenvPip)) {
    $pythonLauncher = Resolve-PythonLauncher
    Write-Log 'Creating backend virtual environment...'
    & $pythonLauncher.Command @($pythonLauncher.Arguments + @('-m', 'venv', $BackendVenvDir))
  }
}

function Build-Icons {
  Write-Log 'Generating branding icons...'
  $pythonLauncher = Resolve-PythonLauncher
  & $pythonLauncher.Command @($pythonLauncher.Arguments + @((Join-Path $RootDir 'scripts/generate-desktop-icons.py')))
}

function Build-Frontend {
  Write-Log 'Building frontend dist...'
  if (-not $SkipDepInstall) {
    Invoke-NpmInstall -WorkingDirectory $FrontendDir
  }

  Push-Location $FrontendDir
  try {
    $env:VITE_API_URL = "http://127.0.0.1:$BackendPort/api"
    $env:VITE_DESKTOP = 'true'
    & npm.cmd run build -- --base ./
  } finally {
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
    Remove-Item Env:VITE_DESKTOP -ErrorAction SilentlyContinue
    Pop-Location
  }
}

function Build-BackendBinary {
  Write-Log 'Building backend with PyInstaller...'
  Ensure-BackendVenv

  if (-not $SkipDepInstall) {
    & $BackendVenvPip install -r (Join-Path $BackendDir 'requirements.txt')
    & $BackendVenvPip install pyinstaller
  }

  Push-Location $BackendDir
  try {
    & $BackendVenvPython -m PyInstaller `
      --noconfirm `
      --clean `
      --onedir `
      --name backend-api `
      --paths $BackendDir `
      --collect-submodules app `
      --collect-all uvicorn `
      --collect-all fastapi `
      --collect-all starlette `
      --collect-all pydantic `
      --collect-all pydantic_settings `
      entrypoint.py
  } finally {
    Pop-Location
  }
}

function Prepare-DesktopPayload {
  Write-Log 'Preparing desktop payload...'
  Remove-PathIfExists $DesktopPayloadFrontendDir
  Remove-PathIfExists $DesktopPayloadBackendDir
  Copy-Item (Join-Path $FrontendDir 'dist') $DesktopPayloadFrontendDir -Recurse
  Copy-Item (Join-Path $BackendDir 'dist/backend-api') $DesktopPayloadBackendDir -Recurse
}

function Package-WindowsDesktop {
  Write-Log 'Packaging Windows desktop app and EXE artifacts...'
  if (-not $SkipDepInstall) {
    Invoke-NpmInstall -WorkingDirectory $DesktopDir -OmitOptional $true
  }

  Push-Location $DesktopDir
  try {
    $builderArgs = @(
      "electron-builder@$ElectronBuilderVersion",
      '--win',
      '--publish',
      'never',
      (Resolve-BuilderArchArgument -Arch $ElectronArch)
    )
    & npx.cmd @builderArgs
  } finally {
    Pop-Location
  }
}

function Assert-WindowsArtifacts {
  $releaseItems = Get-ChildItem $ReleaseDir -ErrorAction Stop
  $installerArtifacts = @($releaseItems | Where-Object { $_.Name -match '-nsis\.exe$' -or $_.Name -match 'setup.*\.exe$' -or $_.Name -match 'setup \d+.*\.exe$' })
  $portableArtifacts = @($releaseItems | Where-Object { $_.Name -match '-portable\.exe$' })
  $unpackedDir = Join-Path $ReleaseDir 'win-unpacked'

  if (-not (Test-Path $unpackedDir)) {
    throw "Missing unpacked Windows app directory: $unpackedDir"
  }
  if ($installerArtifacts.Count -lt 1) {
    throw "Missing Windows installer EXE in $ReleaseDir"
  }
  if ($portableArtifacts.Count -lt 1) {
    throw "Missing Windows portable EXE in $ReleaseDir"
  }

  Write-Log "Installer EXE: $($installerArtifacts[0].Name)"
  Write-Log "Portable EXE: $($portableArtifacts[0].Name)"
}

function Cleanup-BuildOutputs {
  Write-Log 'Cleaning previous build outputs...'
  Remove-PathIfExists $ReleaseDir
  Remove-PathIfExists (Join-Path $FrontendDir 'dist')
  Remove-PathIfExists (Join-Path $BackendDir 'build')
  Remove-PathIfExists (Join-Path $BackendDir 'dist')
  Remove-PathIfExists $DesktopPayloadFrontendDir
  Remove-PathIfExists $DesktopPayloadBackendDir
}

function Main {
  Require-Command npm.cmd
  Require-Command npx.cmd

  $metadata = Get-PackageMetadata
  Write-Log "Starting build for $($metadata.name) v$($metadata.version) ($ElectronArch)..."

  Cleanup-BuildOutputs
  Build-Icons
  Build-Frontend
  Build-BackendBinary
  Prepare-DesktopPayload
  Package-WindowsDesktop
  Assert-WindowsArtifacts

  Write-Log "Build finished. Release output: $ReleaseDir"
}

Main
