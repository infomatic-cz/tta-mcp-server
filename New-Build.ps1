[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path $PSScriptRoot).Path
$buildRoot = 'C:\Temp\TTAMCP-Build'
$workspace = Join-Path $buildRoot 'workspace'
$release = Join-Path $buildRoot 'release'
$archive = Join-Path $buildRoot 'tta-mcp-server-0.1.2.tgz'

function Assert-BuildPath([string]$Path) {
    $rootPath = [IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
    $targetPath = [IO.Path]::GetFullPath($Path)
    if (-not $targetPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside ${buildRoot}: $targetPath"
    }
    return $targetPath
}

function Remove-BuildDirectory([string]$Path) {
    $safePath = Assert-BuildPath $Path
    if (Test-Path -LiteralPath $safePath) {
        Remove-Item -LiteralPath $safePath -Recurse -Force
    }
}

$nodeText = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeText -notmatch '^v(22|24)\.') {
    throw 'Node.js 22 or 24 LTS is required. Install the system-wide Node.js LTS release first.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found on PATH.' }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw 'Windows tar.exe was not found.' }

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$null = Assert-BuildPath $workspace
$null = Assert-BuildPath $release
Remove-BuildDirectory $workspace
Remove-BuildDirectory $release
if (Test-Path -LiteralPath $archive) {
    $null = Assert-BuildPath $archive
    Remove-Item -LiteralPath $archive -Force
}
New-Item -ItemType Directory -Path $workspace -Force | Out-Null

$excluded = @('.git', 'node_modules', 'dist', 'coverage', '.vite')
Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($repoRoot.Length)
    $segments = $relative -split '[\\/]'
    -not ($segments | Where-Object { $excluded -contains $_ })
} | ForEach-Object {
    $relative = $_.FullName.Substring($repoRoot.Length).TrimStart('\')
    $destination = Join-Path $workspace $relative
    $destinationParent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}

$originalNodeOptions = $env:NODE_OPTIONS
try {
    if ($env:NODE_OPTIONS -notmatch '(^|\s)--use-system-ca(\s|$)') {
        $env:NODE_OPTIONS = (($env:NODE_OPTIONS, '--use-system-ca' | Where-Object { $_ }) -join ' ').Trim()
    }
    Push-Location $workspace
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $workspace 'package-lock.json'))) {
            npm install --package-lock-only --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Could not generate package-lock.json.' }
            Copy-Item -LiteralPath (Join-Path $workspace 'package-lock.json') -Destination (Join-Path $repoRoot 'package-lock.json') -Force
        }
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in the temporary build mirror.' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript or Vite build failed.' }
    } finally {
        Pop-Location
    }
} finally {
    $env:NODE_OPTIONS = $originalNodeOptions
}

New-Item -ItemType Directory -Path $release -Force | Out-Null
foreach ($item in @('package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'CODEX_README.md')) {
    Copy-Item -LiteralPath (Join-Path $workspace $item) -Destination $release -Force
}
foreach ($directory in @('dist', 'docs', 'deploy')) {
    Copy-Item -LiteralPath (Join-Path $workspace $directory) -Destination $release -Recurse -Force
}

Push-Location $release
try {
    npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Could not install production dependencies into the release directory.' }
    & tar.exe -czf $archive package.json package-lock.json README.md CHANGELOG.md CODEX_README.md dist docs deploy
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Linux deployment archive.' }
} finally {
    Pop-Location
}

Write-Output "Build complete: $release"
Write-Output "Linux VM artifact: $archive"
