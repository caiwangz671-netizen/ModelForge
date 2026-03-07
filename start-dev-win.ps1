Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [switch]$NoInstall,
  [switch]$BackendOnly,
  [switch]$FrontendOnly,
  [switch]$SkipOllama,
  [string]$BackendPort = '8000',
  [string]$FrontendPort = '5173',
  [string]$OllamaHost = 'http://localhost:11434'
)

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'
$LogDir = Join-Path $RootDir 'logs'
$BackendLog = Join-Path $LogDir 'backend.log'
$FrontendLog = Join-Path $LogDir 'frontend.log'
$StartBackend = -not $FrontendOnly
$StartFrontend = -not $BackendOnly
$InstallDeps = -not $NoInstall
$backendProcess = $null
$frontendProcess = $null

function Write-Log {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
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

function Test-PortOpen {
  param([string]$Port)
  try {
    return [bool](Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction Stop)
  } catch {
    return $false
  }
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

function Stop-ChildProcess {
  param([System.Diagnostics.Process]$Process)
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force
    }
  } catch {
  }
}

function Cleanup {
  Stop-ChildProcess $backendProcess
  Stop-ChildProcess $frontendProcess
}

function Ensure-BackendVenv {
  $pythonLauncher = Resolve-PythonLauncher
  $venvPython = Join-Path $BackendDir 'venv\Scripts\python.exe'
  $venvPip = Join-Path $BackendDir 'venv\Scripts\pip.exe'
  if (-not (Test-Path $venvPython) -or -not (Test-Path $venvPip)) {
    Write-Log 'Creating backend virtual environment...'
    & $pythonLauncher.Command @($pythonLauncher.Arguments + @('-m', 'venv', (Join-Path $BackendDir 'venv')))
  }
}

function Prepare-Backend {
  Ensure-BackendVenv
  if ($InstallDeps) {
    Write-Log 'Installing backend dependencies...'
    & (Join-Path $BackendDir 'venv\Scripts\pip.exe') install -r (Join-Path $BackendDir 'requirements.txt') | Out-Null
  }
}

function Prepare-Frontend {
  Require-Command npm.cmd
  if ($InstallDeps) {
    Write-Log 'Installing frontend dependencies...'
    Push-Location $FrontendDir
    try {
      & npm.cmd install --silent
    } finally {
      Pop-Location
    }
  }
}

function Start-BackendProcess {
  if (Test-PortOpen $BackendPort) {
    throw "Backend port $BackendPort is already in use"
  }
  Write-Log "Starting backend on http://localhost:$BackendPort"
  $venvPython = Join-Path $BackendDir 'venv\Scripts\python.exe'
  $backendProcess = Start-Process `
    -FilePath $venvPython `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload', '--host', '0.0.0.0', '--port', $BackendPort) `
    -WorkingDirectory $BackendDir `
    -RedirectStandardOutput $BackendLog `
    -RedirectStandardError $BackendLog `
    -PassThru

  if (-not (Wait-HttpReady -Url "http://127.0.0.1:$BackendPort/api/system/health" -TimeoutSeconds 45)) {
    Get-Content $BackendLog -Tail 80 -ErrorAction SilentlyContinue
    throw 'Backend startup failed'
  }
}

function Start-FrontendProcess {
  if (Test-PortOpen $FrontendPort) {
    throw "Frontend port $FrontendPort is already in use"
  }
  Write-Log "Starting frontend on http://localhost:$FrontendPort"
  $frontendProcess = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '--host', '0.0.0.0', '--port', $FrontendPort) `
    -WorkingDirectory $FrontendDir `
    -RedirectStandardOutput $FrontendLog `
    -RedirectStandardError $FrontendLog `
    -PassThru

  if (-not (Wait-HttpReady -Url "http://127.0.0.1:$FrontendPort" -TimeoutSeconds 60)) {
    Get-Content $FrontendLog -Tail 80 -ErrorAction SilentlyContinue
    throw 'Frontend startup failed'
  }
}

try {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  if (-not $StartBackend -and -not $StartFrontend) {
    throw 'Nothing to start.'
  }

  Write-Log 'Starting ModelForge development environment...'

  if (-not $SkipOllama -and $StartBackend) {
    try {
      Invoke-WebRequest -Uri "$OllamaHost/api/version" -UseBasicParsing -TimeoutSec 2 | Out-Null
      Write-Log "Ollama is reachable at $OllamaHost"
    } catch {
      Write-Log "WARNING: Ollama is unreachable at $OllamaHost"
    }
  }

  if ($StartBackend) {
    Prepare-Backend
    Start-BackendProcess
  }

  if ($StartFrontend) {
    Prepare-Frontend
    Start-FrontendProcess
  }

  Write-Host ''
  Write-Host '========================================'
  if ($StartFrontend) { Write-Host "Frontend: http://localhost:$FrontendPort" }
  if ($StartBackend) { Write-Host "Backend:  http://localhost:$BackendPort" }
  if ($StartBackend) { Write-Host "API Docs: http://localhost:$BackendPort/docs" }
  Write-Host "Logs:     $BackendLog | $FrontendLog"
  Write-Host 'Press Ctrl+C to stop'

  while ($true) {
    if ($backendProcess -and $backendProcess.HasExited) {
      Get-Content $BackendLog -Tail 80 -ErrorAction SilentlyContinue
      throw 'Backend process exited unexpectedly.'
    }
    if ($frontendProcess -and $frontendProcess.HasExited) {
      Get-Content $FrontendLog -Tail 80 -ErrorAction SilentlyContinue
      throw 'Frontend process exited unexpectedly.'
    }
    Start-Sleep -Seconds 1
  }
} finally {
  Cleanup
}
