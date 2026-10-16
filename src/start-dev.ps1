$ErrorActionPreference = 'Stop'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js and make sure "npm" is available in PATH.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendDirectory = Join-Path $repositoryRoot 'src\frontend'
if (-not (Test-Path (Join-Path $frontendDirectory 'node_modules'))) {
    throw 'Frontend dependencies are missing. Run "npm install" from src\frontend, then try again.'
}

$env:REVIEW_DEMO_MODE = 'mock'
$env:GENLEDGE_DEMO_MODE = '0'
Remove-Item Env:REVIEWER_DEMO_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

$quotedFrontendDirectory = $frontendDirectory.Replace("'", "''")
$frontendCommand = @"
Set-Location -LiteralPath '$quotedFrontendDirectory'
`$env:REVIEW_DEMO_MODE = 'mock'
`$env:GENLEDGE_DEMO_MODE = '0'
Remove-Item Env:REVIEWER_DEMO_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
npm run dev -- --hostname 127.0.0.1
"@
$frontendEncodedCommand = [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($frontendCommand)
)

Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-NoExit',
    '-EncodedCommand',
    $frontendEncodedCommand
) | Out-Null

Write-Host 'Started the mock-only Next.js demo. No FastAPI server or database is used.'
Write-Host 'Keep the frontend PowerShell window open. Open:'
Write-Host '  Business user: http://127.0.0.1:3000/demo'
Write-Host '  Data engineer: http://127.0.0.1:3000/review'
