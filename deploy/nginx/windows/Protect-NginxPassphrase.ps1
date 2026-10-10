[CmdletBinding()]
param(
    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'TTA MCP Server\nginx-secrets\key-passphrase.dpapi')
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This script requires Windows DPAPI.' }
if (-not $env:LOCALAPPDATA) { throw 'Run this script as the Windows account that will run Nginx.' }

$secure = Read-Host 'Zadejte heslo, kterým je zašifrovaný PEM privátní klíč' -AsSecureString
if ($secure.Length -lt 1) { throw 'The PEM passphrase cannot be empty.' }

$fullPath = [IO.Path]::GetFullPath($SecretPath)
$directory = Split-Path -Parent $fullPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$ciphertext = ConvertFrom-SecureString -SecureString $secure
[IO.File]::WriteAllText($fullPath, $ciphertext, [Text.Encoding]::ASCII)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $directory /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict access to the DPAPI secret directory.' }
& icacls.exe $fullPath /inheritance:r /grant:r "${identity}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict access to the DPAPI secret file.' }

$secure.Dispose()
Write-Output "DPAPI protected PEM passphrase saved for Windows account $identity. No plaintext passphrase was written to disk."
