[CmdletBinding()]
param(
    [switch]$Stdio,
    [switch]$Build,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$appNodeText = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $appNodeText -notmatch '^v(?<major>22|24)\.(?<minor>\d+)\.') {
    throw 'Node.js 22.15+ or 24 LTS is required. Install the system-wide Node.js LTS release first.'
}
if ($Matches.major -eq '22' -and [int]$Matches.minor -lt 15) {
    throw 'Node.js 22.15+ is required to load trusted certificates from the Windows system store.'
}
if ($Build -and $Portable) { throw 'The -Build and -Portable switches cannot be used together.' }

$buildRoot = 'C:\Temp\TTAMCP-Build'
$latestReleaseFile = Join-Path $buildRoot 'latest-release.txt'
$buildScript = Join-Path $PSScriptRoot 'New-Build.ps1'

if ($Portable) {
    $releasePath = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    $runtimeFile = Join-Path $releasePath 'runtime.json'
    if (-not (Test-Path -LiteralPath $runtimeFile)) { throw 'Portable package runtime.json is missing. Extract the complete Windows ZIP package first.' }
    $runtimeInfo = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
    $runningNodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
    $runningNodeArch = (& node -p "process.arch").Trim()
    if ($runningNodeArch -ne $runtimeInfo.arch -or $runningNodeMajor -ne [int]$runtimeInfo.nodeMajor) {
        throw "Portable package requires Node.js $($runtimeInfo.nodeMajor) $($runtimeInfo.arch); current runtime is Node.js major $runningNodeMajor $runningNodeArch."
    }
} else {
    if ($Build -or -not (Test-Path -LiteralPath $latestReleaseFile)) {
        if ($Stdio) { & $buildScript *> $null } else { & $buildScript }
    }

    if (-not (Test-Path -LiteralPath $latestReleaseFile)) { throw 'Build did not write the latest release pointer.' }
    $release = [IO.File]::ReadAllText($latestReleaseFile).Trim()
    $rootPath = [IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
    $releasePath = [IO.Path]::GetFullPath($release)
    if (-not $releasePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Latest release points outside C:\Temp\TTAMCP-Build.' }
}
$entry = Join-Path $releasePath 'dist\server\index.js'
if (-not (Test-Path -LiteralPath $entry)) { throw 'Build did not produce the server entry point.' }

$dataDir = Join-Path $env:LOCALAPPDATA 'TTA MCP Server'
$keyPath = Join-Path $dataDir 'vault-key.dpapi'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $keyPath)) {
    $random = [byte[]]::new(32)
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomGenerator.GetBytes($random)
    } finally {
        $randomGenerator.Dispose()
    }
    $plainKey = [Convert]::ToBase64String($random)
    [Array]::Clear($random, 0, $random.Length)
    $secureKey = ConvertTo-SecureString -String $plainKey -AsPlainText -Force
    $protectedKey = ConvertFrom-SecureString -SecureString $secureKey
    [IO.File]::WriteAllText($keyPath, $protectedKey, [Text.Encoding]::ASCII)
    $plainKey = $null
    $secureKey.Dispose()
}

$storedKey = [IO.File]::ReadAllText($keyPath, [Text.Encoding]::ASCII)
$secureStoredKey = ConvertTo-SecureString -String $storedKey
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureStoredKey)
$clearKey = $null
try {
    $clearKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureStoredKey.Dispose()
}

$priorVaultKey = $env:TTA_VAULT_KEY
$priorDataDir = $env:TTA_DATA_DIR
$priorPort = $env:TTA_PORT
$priorNodeOptions = $env:NODE_OPTIONS
$env:TTA_VAULT_KEY = $clearKey
$env:TTA_DATA_DIR = $dataDir
$env:TTA_PORT = if ($env:TTA_PORT) { $env:TTA_PORT } else { '8380' }
if ($env:NODE_OPTIONS -notmatch '(^|\s)--use-system-ca(\s|$)') {
    $env:NODE_OPTIONS = (($env:NODE_OPTIONS, '--use-system-ca' | Where-Object { $_ }) -join ' ').Trim()
}
$clearKey = $null

try {
    if ($Stdio) {
        & node $entry --stdio
    } else {
        $url = "http://127.0.0.1:$($env:TTA_PORT)"
        Write-Output "Server will be available at $url. Open it in your browser after startup."
        & node $entry
    }
} finally {
    $env:TTA_VAULT_KEY = $priorVaultKey
    $env:TTA_DATA_DIR = $priorDataDir
    $env:TTA_PORT = $priorPort
    $env:NODE_OPTIONS = $priorNodeOptions
}
