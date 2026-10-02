$ErrorActionPreference = 'Stop'
$certificateDirectory = Join-Path $PSScriptRoot '../.cache/local-https'
$pfxPath = Join-Path $certificateDirectory 'localhost.pfx'
if (Test-Path -LiteralPath $pfxPath) {
    throw 'Local certificate already exists. See docs/entra-local-windows.md for renewal.'
}
New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
$certificate = New-SelfSignedCertificate -Type SSLServerAuthentication `
    -Subject 'CN=localhost' -DnsName 'localhost' `
    -FriendlyName 'Work Order Scheduler localhost test' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(30)
$passwordBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$pfxPassword = [Convert]::ToBase64String($passwordBytes)
$securePassword = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
[IO.File]::WriteAllText((Join-Path $certificateDirectory 'pfx-password.txt'), $pfxPassword)
$publicPath = Join-Path $certificateDirectory 'localhost.cer'
Export-Certificate -Cert $certificate -FilePath $publicPath | Out-Null
Import-Certificate -FilePath $publicPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
[IO.File]::WriteAllText((Join-Path $certificateDirectory 'thumbprint.txt'), $certificate.Thumbprint)
Write-Output "Local HTTPS certificate trusted for current Windows user; expires $($certificate.NotAfter.ToString('yyyy-MM-dd'))."
