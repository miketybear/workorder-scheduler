$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$backendEnvPath = Join-Path $projectDirectory 'backend/.env'
$databaseEnvPath = Join-Path $projectDirectory '.cache/entra-local-db.env'
if ((Test-Path -LiteralPath $backendEnvPath) -or (Test-Path -LiteralPath $databaseEnvPath)) {
    throw 'Local environment files already exist; preserve them and follow docs/entra-local-windows.md.'
}
New-Item -ItemType Directory -Path (Join-Path $projectDirectory '.cache') -Force | Out-Null
$passwordBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$databasePassword = -join ($passwordBytes | ForEach-Object { $_.ToString('x2') })
[IO.File]::WriteAllText($databaseEnvPath, "WOS_LOCAL_DB_PASSWORD=$databasePassword`n")
$backendConfiguration = @"
WOS_ENVIRONMENT=development
WOS_DATABASE_URL=postgresql+psycopg://scheduler_entra_local:${databasePassword}@127.0.0.1:55433/scheduler_entra_local
# Uncomment all four Entra fields together after registering the callback and adding the secret.
# WOS_ENTRA__TENANT_ID=f9e06204-6d4e-4c6b-935b-52a3151e25a8
# WOS_ENTRA__CLIENT_ID=6a8601d2-efd9-42e4-b19b-c507f384c069
# WOS_ENTRA__CLIENT_SECRET=
# WOS_ENTRA__REDIRECT_URI=https://localhost:5173/api/auth/callback
"@
[IO.File]::WriteAllText($backendEnvPath, $backendConfiguration + "`n")
Write-Output 'Created ignored local backend/database settings; Entra remains disabled until all four fields are completed.'
