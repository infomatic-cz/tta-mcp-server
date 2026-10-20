[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$SiteName,
    [Parameter(Mandatory = $true)] [string]$ApplicationPath,
    [Parameter(Mandatory = $true)] [string]$PublicOrigin,
    [string]$InstallRoot = 'C:\Apps\TTA MCP IIS',
    [string]$AppPoolName = 'TtaMcpIIS',
    [string]$NodeExePath = 'C:\Program Files\nodejs\node.exe',
    [switch]$SkipBootstrapCode
)

#Requires -RunAsAdministrator
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

function Invoke-Icacls([string]$Path, [string[]]$Arguments) {
    & "$env:SystemRoot\System32\icacls.exe" $Path @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Could not set the required ACL on $Path (icacls exit code $LASTEXITCODE)." }
}

function Get-XmlValue([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

function Get-LatestReadyPort([string]$LogDirectory) {
    $logs = Get-ChildItem -LiteralPath $LogDirectory -File -Filter 'httpplatform*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    foreach ($log in $logs) {
        foreach ($line in (Get-Content -LiteralPath $log.FullName -Tail 300 -ErrorAction SilentlyContinue)) {
            if ($line -notmatch 'TTA MCP Server is ready') { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $port = [int]$entry.port
                if ($port -ge 1 -and $port -le 65535) { return $port }
            } catch { }
        }
    }
    return $null
}

$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
$runtimeFile = Join-Path $sourceRoot 'runtime.json'
$templateFile = Join-Path $sourceRoot 'deploy\iis\web.config.template'
if (-not (Test-Path -LiteralPath $runtimeFile)) { throw 'runtime.json is missing. Extract the complete IIS ZIP package before deploying.' }
if (-not (Test-Path -LiteralPath $templateFile)) { throw 'IIS web.config template is missing from the package.' }
if (-not (Test-Path -LiteralPath $NodeExePath)) { throw "Node.js was not found at '$NodeExePath'. Install the required x64 Node.js runtime or pass -NodeExePath." }

$runtimeInfo = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
if ($runtimeInfo.platform -ne 'win32' -or $runtimeInfo.arch -ne 'x64') { throw 'This package is not a Windows x64 build.' }
$nodeVersion = (& $NodeExePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>22|24)\.') { throw 'Node.js 22.15+ or 24 LTS x64 is required.' }
if ([int]$Matches.major -ne [int]$runtimeInfo.nodeMajor) { throw "This package requires Node.js major $($runtimeInfo.nodeMajor); found $nodeVersion." }

$publicUri = $null
if (-not [Uri]::TryCreate($PublicOrigin, [UriKind]::Absolute, [ref]$publicUri) -or
    $publicUri.Scheme -ne 'https' -or $publicUri.AbsolutePath -ne '/' -or $publicUri.Query -or $publicUri.Fragment -or $publicUri.UserInfo -or $publicUri.Port -ne 443) {
    throw 'PublicOrigin must be the HTTPS origin on port 443 only, without a path, query, or credentials; for example https://tta-mcp.example.cz.'
}
$origin = $publicUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')

$applicationPath = '/' + $ApplicationPath.Trim('/')
if ($applicationPath -notmatch '^/[A-Za-z0-9_-]+$') { throw 'ApplicationPath must be one IIS path segment, for example /tta-mcp.' }
$AppPoolName = $AppPoolName.Trim()
if ($AppPoolName -notmatch '^[A-Za-z0-9_.-]{1,64}$') { throw 'AppPoolName may contain only letters, numbers, dot, underscore and hyphen (maximum 64 characters).' }
$applicationName = $applicationPath.TrimStart('/')
$basePath = $applicationPath

if (-not (Get-Module -ListAvailable -Name WebAdministration)) { throw 'IIS PowerShell management tools are missing. Add the IIS Management Scripts and Tools feature.' }
Import-Module WebAdministration
$website = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if (-not $website) { throw "IIS site '$SiteName' was not found." }
$httpsBindings = @(Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue)
$matchingBinding = $httpsBindings | Where-Object {
    $parts = $_.bindingInformation -split ':', 3
    $parts.Count -eq 3 -and $parts[1] -eq '443' -and (($parts[2] -eq '') -or ($parts[2] -ieq $publicUri.Host))
} | Select-Object -First 1
if (-not $matchingBinding) { throw "IIS site '$SiteName' needs an existing HTTPS binding on port 443 that serves '$($publicUri.Host)'." }

$iisModules = @(Get-WebGlobalModule -ErrorAction SilentlyContinue)
if (-not ($iisModules | Where-Object { $_.Name -ieq 'httpPlatformHandler' })) {
    throw 'HttpPlatformHandler is not installed in IIS. Install the x64 module from https://learn.iis.net/downloads/microsoft/httpplatformhandler, then rerun this script.'
}

$appPoolPath = "IIS:\AppPools\$AppPoolName"
if (-not (Test-Path -LiteralPath $appPoolPath)) { New-WebAppPool -Name $AppPoolName | Out-Null }
Set-ItemProperty -LiteralPath $appPoolPath -Name managedRuntimeVersion -Value ''
Set-ItemProperty -LiteralPath $appPoolPath -Name startMode -Value 'AlwaysRunning'
Set-ItemProperty -LiteralPath $appPoolPath -Name 'processModel.idleTimeout' -Value ([TimeSpan]::Zero)
Set-ItemProperty -LiteralPath $appPoolPath -Name 'processModel.identityType' -Value 'ApplicationPoolIdentity'
Set-ItemProperty -LiteralPath $appPoolPath -Name enable32BitAppOnWin64 -Value $false
$poolIdentity = "IIS AppPool\$AppPoolName"

$installRootFull = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$releasesRoot = Join-Path $installRootFull 'releases'
$releasePath = Join-Path $releasesRoot ([string]$runtimeInfo.appVersion)
New-Item -ItemType Directory -Path $releasesRoot -Force | Out-Null
if ($sourceRoot -ne [IO.Path]::GetFullPath($releasePath).TrimEnd('\')) {
    if (Test-Path -LiteralPath $releasePath) { throw "Release folder already exists: $releasePath. Use a fresh version directory; existing releases are never overwritten." }
    New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $releasePath -Recurse -Force
}

$dataRoot = Join-Path $env:ProgramData 'TTA MCP IIS'
$dataDirectory = Join-Path $dataRoot 'data'
$logDirectory = Join-Path $dataRoot 'logs'
$dpapiKeyFile = Join-Path $dataDirectory 'vault-key.dpapi'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

foreach ($protectedDirectory in @($dataRoot, $dataDirectory, $logDirectory)) {
    Invoke-Icacls $protectedDirectory @('/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)(F)', '*S-1-5-32-544:(OI)(CI)(F)', "${poolIdentity}:(OI)(CI)(M)")
}

Add-Type -AssemblyName System.Security
if (-not (Test-Path -LiteralPath $dpapiKeyFile)) {
    $plainKey = [byte[]]::new(32)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($plainKey)
        $protectedKey = [Security.Cryptography.ProtectedData]::Protect($plainKey, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes($dpapiKeyFile, $protectedKey)
        [Array]::Clear($protectedKey, 0, $protectedKey.Length)
    } finally {
        [Array]::Clear($plainKey, 0, $plainKey.Length)
        $rng.Dispose()
    }
}

Invoke-Icacls $releasePath @('/grant', "${poolIdentity}:(OI)(CI)(RX)", '/T', '/C')

$appEntry = Join-Path $releasePath 'dist\server\index.js'
$webConfig = Join-Path $releasePath 'web.config'
if (-not (Test-Path -LiteralPath $appEntry)) { throw 'Compiled server entry point is missing from the package.' }
$template = [IO.File]::ReadAllText($templateFile)
$replacements = @{
    '@@NODE_EXE@@' = Get-XmlValue $NodeExePath
    '@@APP_ENTRY@@' = Get-XmlValue $appEntry
    '@@BASE_PATH@@' = Get-XmlValue $basePath
    '@@DATA_DIR@@' = Get-XmlValue $dataDirectory
    '@@DPAPI_KEY_FILE@@' = Get-XmlValue $dpapiKeyFile
    '@@PUBLIC_ORIGIN@@' = Get-XmlValue $origin
    '@@STDOUT_LOG@@' = Get-XmlValue (Join-Path $logDirectory 'httpplatform')
}
foreach ($key in $replacements.Keys) { $template = $template.Replace($key, $replacements[$key]) }
[IO.File]::WriteAllText($webConfig, $template, [Text.UTF8Encoding]::new($false))

$existingApp = @(Get-WebApplication -Site $SiteName | Where-Object { $_.Path -ieq $applicationPath }) | Select-Object -First 1
if ($existingApp) {
    $oldPhysicalPath = [IO.Path]::GetFullPath($existingApp.PhysicalPath).TrimEnd('\')
    if (-not $oldPhysicalPath.StartsWith($installRootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "IIS application $applicationPath already points outside '$installRootFull'; refusing to repoint an unrelated application."
    }
    Set-ItemProperty -LiteralPath "IIS:\Sites\$SiteName\$applicationName" -Name physicalPath -Value $releasePath
    Set-ItemProperty -LiteralPath "IIS:\Sites\$SiteName\$applicationName" -Name applicationPool -Value $AppPoolName
} else {
    New-WebApplication -Site $SiteName -Name $applicationName -PhysicalPath $releasePath -ApplicationPool $AppPoolName | Out-Null
}
Set-ItemProperty -LiteralPath "IIS:\Sites\$SiteName\$applicationName" -Name preloadEnabled -Value $true
$poolState = (Get-WebAppPoolState -Name $AppPoolName).Value
if ($poolState -eq 'Started') { Restart-WebAppPool -Name $AppPoolName } else { Start-WebAppPool -Name $AppPoolName }

$healthUrl = "$origin$basePath/health/ready"
$health = $null
for ($attempt = 0; $attempt -lt 60 -and -not $health; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Output "IIS application deployed to: $releasePath"
Write-Output "Admin UI: $origin$basePath/"
Write-Output "Health:   $healthUrl"
Write-Output "MCP URL:  $origin$basePath/tta-mcp"
if ($health) { Write-Output 'Health check: ready' } else { Write-Warning "The app did not answer the HTTPS health check yet. Review IIS/HttpPlatformHandler logs in '$logDirectory'." }

if (-not $SkipBootstrapCode) {
    $port = Get-LatestReadyPort $logDirectory
    if ($port) {
        try {
            $setup = Invoke-RestMethod -Uri "http://127.0.0.1:$port$basePath/api/setup" -Method Get -TimeoutSec 5
            if ($setup.required -and $setup.setupCode) {
                Write-Host ''
                Write-Host 'Jednorázový instalační kód správce (zadejte ho do Admin UI):' -ForegroundColor Yellow
                Write-Host $setup.setupCode -ForegroundColor Yellow
                Write-Host 'Kód platí 30 minut a po založení správce přestane fungovat.' -ForegroundColor Yellow
            } elseif (-not $setup.required) {
                Write-Output 'Initial administrator already exists; sign in with the existing account.'
            } else {
                Write-Warning 'IIS app is running, but the one-time setup code was not available. Run this script locally again or inspect the IIS application logs.'
            }
        } catch {
            Write-Warning "Could not retrieve the one-time setup code from the local IIS worker. Review '$logDirectory' and restart the app pool if required."
        }
    } else {
        Write-Warning "Could not read the IIS worker port from '$logDirectory'; use the HTTPS health URL and review the HttpPlatformHandler startup logs."
    }
}
