$ErrorActionPreference = 'Stop'

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python was not found. Install Python and make sure "python" is available in PATH.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js and make sure "npm" is available in PATH.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendDirectory = Join-Path $repositoryRoot 'src\frontend'
$requirementsFile = Join-Path $repositoryRoot 'requirements.txt'
$pythonPath = (Get-Command python).Source

if (-not (Test-Path (Join-Path $frontendDirectory 'node_modules'))) {
    throw 'Frontend dependencies are missing. Run "npm install" from src\frontend, then try again.'
}

$null = & $pythonPath -m pip show fastapi uvicorn *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing the backend requirements for the Python interpreter on PATH...'
    & $pythonPath -m pip install -r $requirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw 'Backend dependency installation failed. Check the pip output and try again.'
    }
}

$quotedRepositoryRoot = $repositoryRoot.Replace("'", "''")
$quotedFrontendDirectory = $frontendDirectory.Replace("'", "''")
$quotedPythonPath = $pythonPath.Replace("'", "''")

$backendCommand = "Set-Location -LiteralPath '$quotedRepositoryRoot'; & '$quotedPythonPath' -m uvicorn src.backend.app:app --reload"
$frontendCommand = "Set-Location -LiteralPath '$quotedFrontendDirectory'; npm run dev"

$backendEncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($backendCommand))
$frontendEncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($frontendCommand))

$backendHealthUrl = 'http://127.0.0.1:8000/api/health'
$backendAlreadyRunning = $false
try {
    $health = Invoke-RestMethod -Uri $backendHealthUrl -TimeoutSec 2
    $backendAlreadyRunning = $health.status -eq 'ok'
} catch {
    $backendAlreadyRunning = $false
}

if (-not $backendAlreadyRunning) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-NoExit',
        '-EncodedCommand',
        $backendEncodedCommand
    ) | Out-Null

    Write-Host 'Waiting for the backend health check...'
    $backendReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $health = Invoke-RestMethod -Uri $backendHealthUrl -TimeoutSec 2
            if ($health.status -eq 'ok') {
                $backendReady = $true
                break
            }
        } catch {
            # The backend may need a moment to start.
        }
    }

    if (-not $backendReady) {
        throw 'The backend did not become ready. Check its PowerShell window for startup errors; the frontend was not started.'
    }
} else {
    Write-Host 'Using the backend already running on port 8000.'
}

Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-NoExit',
    '-EncodedCommand',
    $frontendEncodedCommand
) | Out-Null

Write-Host 'Started the Next.js frontend in a new PowerShell window. The backend health check passed.'
Write-Host 'Keep both windows open. Next.js will print the frontend URL when it is ready (usually http://localhost:3000).'
