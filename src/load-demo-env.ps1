$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot '.env'
if (-not (Test-Path -LiteralPath $environmentFile)) {
    throw 'The repository root .env file is required for the local review demo.'
}

foreach ($line in Get-Content -LiteralPath $environmentFile) {
    $entry = $line.Trim()
    if (-not $entry -or $entry.StartsWith('#')) {
        continue
    }

    if ($entry -match '^(?:export\s+)?(DATABASE_URL|REVIEWER_DEMO_SECRET)\s*=\s*(.*)$') {
        $name = $matches[1]
        $value = $matches[2].Trim()
        if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'")))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

if (-not $env:DATABASE_URL -or -not $env:REVIEWER_DEMO_SECRET) {
    throw 'The root .env must define non-empty DATABASE_URL and REVIEWER_DEMO_SECRET values.'
}

$env:APP_ENV = 'development'
$env:GENLEDGE_DEMO_MODE = '1'
$env:REVIEW_DEMO_MODE = 'real'

Write-Host 'Loaded local demo configuration from the root .env; secret values were not displayed.'
