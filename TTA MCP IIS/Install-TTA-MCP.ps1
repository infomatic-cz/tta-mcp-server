[CmdletBinding()]
param(
    [string]$SiteName = 'Default Web Site',
    [string]$ApplicationPath = 'tta-mcp',
    # Optional override when the IIS site has several/wildcard HTTPS host bindings.
    [string]$ServerHost,
    [string]$InstallRoot = 'C:\Apps\TTAMCP',
    [string]$PackagePath,
    [string]$AppPoolName = 'TtaMcpIIS',
    [string]$ServiceAccount,
    [switch]$UseApplicationPoolIdentity,
    [string]$NodeExePath = 'C:\Program Files\nodejs\node.exe'
)

#Requires -RunAsAdministrator
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'

# IIS management through the built-in AppCmd.exe. No WebAdministration module or IIS: drive needed.
# Tested by static review against IIS 10 AppCmd command syntax; actual server execution requires Windows/IIS.
function Initialize-IisNative {
    if (-not $IsWindows) { throw 'This deployment script must run on Windows Server.' }
    if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell 7 (pwsh.exe), not x86 PowerShell.' }
    $script:AppCmdExe = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
    if (-not (Test-Path -LiteralPath $script:AppCmdExe -PathType Leaf)) {
        throw 'IIS AppCmd.exe is missing. Install the IIS Web Server and IIS Management Scripts and Tools features.'
    }
}

function Invoke-AppCmd {
    param([Parameter(Mandatory)][string[]] $Arguments)
    # Call the native executable with an array, preserving paths containing spaces.
    $lines = @(& $script:AppCmdExe @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $message = ($lines | ForEach-Object { [string]$_ }) -join "`n"
    if ($exitCode -ne 0) {
        throw "IIS AppCmd.exe failed (exit $exitCode): appcmd $($Arguments -join ' ')`n$message"
    }
    return $message
}

function Get-IisObjects {
    param([Parameter(Mandatory)][ValidateSet('site', 'app', 'vdir', 'apppool', 'module')][string] $Entity)
    $raw = Invoke-AppCmd -Arguments @('list', $Entity, '/xml')
    if ([string]::IsNullOrWhiteSpace($raw)) { return }
    try { [xml]$document = $raw }
    catch { throw "Cannot parse AppCmd XML for $Entity : $($_.Exception.Message)" }
    foreach ($entry in $document.DocumentElement.ChildNodes) {
        if ($entry.NodeType -eq [Xml.XmlNodeType]::Element) { $entry }
    }
}

function Get-IisSite {
    param([string] $Name)
    @(Get-IisObjects -Entity 'site') | Where-Object { $_.GetAttribute('SITE.NAME') -ieq $Name } | Select-Object -First 1
}

function Get-IisApplication {
    param([string] $SiteName, [string] $ApplicationName)
    $fullName = "$SiteName/$ApplicationName"
    @(Get-IisObjects -Entity 'app') | Where-Object { $_.GetAttribute('APP.NAME') -ieq $fullName } | Select-Object -First 1
}

function Get-IisPhysicalPath {
    param([string] $SiteName, [string] $ApplicationName)
    $fullName = "$SiteName/$ApplicationName/"
    $item = @(Get-IisObjects -Entity 'vdir') | Where-Object { $_.GetAttribute('VDIR.NAME') -ieq $fullName } | Select-Object -First 1
    if ($null -eq $item) { throw "The IIS root virtual directory '$fullName' was not found." }
    $path = $item.GetAttribute('physicalPath')
    if ([string]::IsNullOrWhiteSpace($path)) { throw "IIS virtual directory '$fullName' has no physical path." }
    return [Environment]::ExpandEnvironmentVariables($path)
}

function Get-IisAppPool {
    param([string] $Name)
    @(Get-IisObjects -Entity 'apppool') | Where-Object { $_.GetAttribute('APPPOOL.NAME') -ieq $Name } | Select-Object -First 1
}

function Test-IisHttpsBinding {
    param([Parameter(Mandatory)] $Site, [string] $Hostname, [switch] $Port443)
    $bindingText = $Site.GetAttribute('bindings')
    foreach ($binding in ($bindingText -split ',')) {
        if ($binding -notmatch '^https/(.*):(\d+):([^:]*)$') { continue }
        if ($Port443 -and [int]$Matches[2] -ne 443) { continue }
        if ($Hostname -and $Matches[3] -and $Matches[3] -ine $Hostname) { continue }
        return $true
    }
    return $false
}

# Determine the server part of https://<server>/<application> using existing IIS bindings.
# Select a server host from the existing HTTPS bindings without prompting.
# Never create or edit an IIS site, binding or TLS certificate.
function Get-IisHttpsOrigin {
    param(
        [Parameter(Mandatory)] $Site,
        [string] $RequestedHost
    )
    $httpsBindings = @()
    foreach ($binding in ([string]$Site.GetAttribute('bindings') -split ',')) {
        if ($binding -match '^https/(.*):(\d+):([^:]*)$' -and [int]$Matches[2] -eq 443) {
            $httpsBindings += [PSCustomObject]@{ Host = $Matches[3]; Raw = $binding }
        }
    }
    if ($httpsBindings.Count -eq 0) {
        throw "The selected IIS website has no existing HTTPS binding on port 443. Set up HTTPS on the IIS site first."
    }

    $boundHosts = @($httpsBindings | ForEach-Object Host | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $selectedHost = $RequestedHost
    if ([string]::IsNullOrWhiteSpace($selectedHost)) {
        if ($boundHosts.Count -ge 1) {
            $selectedHost = $boundHosts[0]
            Write-Host "Using existing IIS HTTPS server: $selectedHost" -ForegroundColor Cyan
            if ($boundHosts.Count -gt 1) {
                Write-Warning "Several HTTPS hostnames are configured. Using the first binding '$selectedHost'; pass -ServerHost to select another hostname."
            }
        } else {
            try {
                $selectedHost = [Net.Dns]::GetHostEntry([Net.Dns]::GetHostName()).HostName
            } catch {
                $selectedHost = $env:COMPUTERNAME
            }
            Write-Warning "The HTTPS binding has no hostname. Using this server name: $selectedHost. Pass -ServerHost to override it if the TLS certificate uses another name."
        }
    }
    $selectedHost = ([string]$selectedHost).Trim()
    if ($selectedHost -match '[/\\\s:@?#]' -or [string]::IsNullOrWhiteSpace($selectedHost)) {
        throw 'Enter only the existing server hostname or IPv4 address (e.g. server.company.cz), not a URL.'
    }
    if ($selectedHost -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' -or $selectedHost.Length -gt 253) {
        throw 'The server name must be a valid DNS hostname or IPv4 address.'
    }
    $originUri = $null
    if (-not [Uri]::TryCreate("https://$selectedHost/", [UriKind]::Absolute, [ref]$originUri) -or
        $originUri.Scheme -ne 'https' -or $originUri.Port -ne 443) {
        throw 'Could not construct an HTTPS server URL from the selected hostname.'
    }
    if (-not (Test-IisHttpsBinding -Site $Site -Hostname $selectedHost -Port443)) {
        throw "HTTPS hostname '$selectedHost' does not match any existing binding of this IIS site."
    }
    return $originUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}

function Ensure-IisAppPool {
    param([string] $PoolName, [string] $TargetApp, [switch] $AlwaysRunning)
    $existingPool = Get-IisAppPool -Name $PoolName
    if ($null -ne $existingPool) {
        # Do not reconfigure a pool that also hosts other applications.
        $otherApps = @(Get-IisObjects -Entity 'app') | Where-Object {
            $_.GetAttribute('APPPOOL.NAME') -ieq $PoolName -and $_.GetAttribute('APP.NAME') -ine $TargetApp
        }
        if ($otherApps.Count -gt 0) {
            throw "Pool '$PoolName' is shared with other IIS applications. Choose a dedicated -AppPoolName."
        }
    } else {
        Invoke-AppCmd -Arguments @('add', 'apppool', "/name:$PoolName") | Out-Null
        Invoke-AppCmd -Arguments @('set', 'apppool', $PoolName, '/processModel.identityType:ApplicationPoolIdentity') | Out-Null
    }
    $settings = @('set', 'apppool', $PoolName,
        '/managedRuntimeVersion:', '/managedPipelineMode:Integrated',
        '/enable32BitAppOnWin64:false')
    if ($AlwaysRunning) {
        $settings += @('/startMode:AlwaysRunning', '/processModel.idleTimeout:00:00:00')
    }
    Invoke-AppCmd -Arguments $settings | Out-Null
}

function Set-IisApplicationDeployment {
    param([string] $SiteName, [string] $ApplicationName, [string] $ReleasePath, [string] $PoolName,
          [switch] $Preload)
    $identity = "$SiteName/$ApplicationName"
    if ($null -eq (Get-IisApplication -SiteName $SiteName -ApplicationName $ApplicationName)) {
        Invoke-AppCmd -Arguments @('add', 'app', "/site.name:$SiteName", "/path:/$ApplicationName", "/physicalPath:$ReleasePath") | Out-Null
    } else {
        Invoke-AppCmd -Arguments @('set', 'vdir', "$identity/", "/physicalPath:$ReleasePath") | Out-Null
    }
    $settings = @('set', 'app', $identity, "/applicationPool:$PoolName")
    if ($Preload) { $settings += '/preloadEnabled:true' }
    Invoke-AppCmd -Arguments $settings | Out-Null
}


# IIS management API works directly in PowerShell 7; used ONLY for secure app-pool credentials.
# Never supply service account passwords on the AppCmd.exe command line.
function Initialize-IisPoolApi {
    $assembly = Join-Path $env:SystemRoot 'System32\inetsrv\Microsoft.Web.Administration.dll'
    if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) {
        throw 'Microsoft.Web.Administration.dll is missing. Install IIS Management Scripts and Tools.'
    }
    try { Add-Type -Path $assembly -ErrorAction Stop }
    catch { throw "Unable to load the IIS administration API in PowerShell 7: $($_.Exception.Message)" }
}

function Get-IisPoolPrincipal {
    param([Parameter(Mandatory)][string] $PoolName)
    $manager = [Microsoft.Web.Administration.ServerManager]::new()
    try {
        $pool = $manager.ApplicationPools[$PoolName]
        if ($null -eq $pool) { throw "Application pool '$PoolName' was not found." }
        switch ([string]$pool.ProcessModel.IdentityType) {
            'SpecificUser' {
                $account = [string]$pool.ProcessModel.UserName
                if ([string]::IsNullOrWhiteSpace($account)) {
                    throw "Application pool '$PoolName' has a custom identity without a user name."
                }
                return $account
            }
            'ApplicationPoolIdentity' { return "IIS AppPool\$PoolName" }
            'NetworkService'        { return 'NT AUTHORITY\NETWORK SERVICE' }
            'LocalService'          { return 'NT AUTHORITY\LOCAL SERVICE' }
            'LocalSystem'           { return 'NT AUTHORITY\SYSTEM' }
            default { throw "Unsupported identity type for '$PoolName': $($pool.ProcessModel.IdentityType)" }
        }
    } finally { $manager.Dispose() }
}

function Set-IisPoolAccount {
    param(
        [Parameter(Mandatory)][string] $PoolName,
        [string] $ServiceAccount,
        [switch] $UseApplicationPoolIdentity
    )
    if (-not [string]::IsNullOrWhiteSpace($ServiceAccount) -and $UseApplicationPoolIdentity) {
        throw 'Choose either -ServiceAccount or -UseApplicationPoolIdentity, not both.'
    }
    if ([string]::IsNullOrWhiteSpace($ServiceAccount) -and -not $UseApplicationPoolIdentity) {
        # Keep the existing pool identity and its stored credentials on upgrades.
        return
    }

    $manager = [Microsoft.Web.Administration.ServerManager]::new()
    try {
        $pool = $manager.ApplicationPools[$PoolName]
        if ($null -eq $pool) { throw "Application pool '$PoolName' does not exist." }
        if ($UseApplicationPoolIdentity) {
            $pool.ProcessModel.IdentityType = [Microsoft.Web.Administration.ProcessModelIdentityType]::ApplicationPoolIdentity
            $pool.ProcessModel.UserName = ''
            $pool.ProcessModel.Password = ''
            $manager.CommitChanges()
            return
        }

        $accountName = $ServiceAccount.Trim()
        if ($accountName -notmatch '^(?:[^\\]+\\[^\\]+|[^@]+@[^@]+)$') {
            throw 'ServiceAccount must be DOMAIN\\user, .\\localuser, or user@domain.'
        }
        # Verify that the account exists and is resolvable before requesting its password.
        try {
            $sid = ([Security.Principal.NTAccount]::new($accountName)).Translate([Security.Principal.SecurityIdentifier])
        } catch { throw "Windows cannot resolve service account '$accountName'. Check the account and domain connectivity." }
        if ($sid.Value -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20', 'S-1-5-32-544')) {
            throw 'A built-in privileged or service account cannot be passed via -ServiceAccount.'
        }
        Write-Host "Password for IIS application-pool identity $accountName (input hidden):" -ForegroundColor Cyan
        $secret = Read-Host -Prompt 'Password' -AsSecureString
        if ($null -eq $secret -or $secret.Length -eq 0) { throw 'A nonempty service account password is required.' }
        $secretPointer = [IntPtr]::Zero
        $passwordText = $null
        try {
            $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
            $passwordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
            $pool.ProcessModel.IdentityType = [Microsoft.Web.Administration.ProcessModelIdentityType]::SpecificUser
            $pool.ProcessModel.UserName = $accountName
            $pool.ProcessModel.Password = $passwordText
            $manager.CommitChanges()  # IIS encrypts this sensitive setting in applicationHost.config.
        } catch {
            # Deliberately avoid embedding the provider exception (may expose sensitive information).
            throw "Failed to configure custom identity for application pool '$PoolName'. Review IIS and Windows Event Logs."
        } finally {
            $passwordText = $null
            if ($secretPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
            }
            $secret.Dispose()
        }
    } finally { $manager.Dispose() }
}

function Remove-PreviousDataAccess {
    param([string]$Path, [string]$PreviousAccount, [string]$NewAccount)
    if ([string]::IsNullOrWhiteSpace($PreviousAccount) -or $PreviousAccount -ieq $NewAccount) { return }
    if ($PreviousAccount -in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) { return }
    # This directory belongs exclusively to the application, so stale worker access is removed.
    $acl = Get-Acl -LiteralPath $Path
    try { $oldSid = ([Security.Principal.NTAccount]::new($PreviousAccount)).Translate([Security.Principal.SecurityIdentifier]) }
    catch { Write-Warning "Could not resolve old account '$PreviousAccount' to remove its previous ACL. Check permissions manually."; return }
    foreach ($rule in @($acl.Access)) {
        try { $ruleSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]) }
        catch { continue }
        if ($ruleSid.Value -eq $oldSid.Value -and -not $rule.IsInherited) {
            [void] $acl.RemoveAccessRuleSpecific($rule)
        }
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Start-Or-RecycleIisPool {
    param([string] $PoolName, [switch] $RecycleIfStarted)
    $pool = Get-IisAppPool -Name $PoolName
    if ($null -eq $pool) { throw "Application pool '$PoolName' does not exist." }
    $status = $pool.GetAttribute('state')
    if ($status -eq 'Started') {
        if ($RecycleIfStarted) { Invoke-AppCmd -Arguments @('recycle', 'apppool', $PoolName) | Out-Null }
    } else {
        Invoke-AppCmd -Arguments @('start', 'apppool', $PoolName) | Out-Null
    }
}

function Invoke-Icacls([string]$Path, [string[]]$Arguments) {
    & "$env:SystemRoot\System32\icacls.exe" $Path @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Could not set the required ACL on $Path (icacls exit code $LASTEXITCODE)." }
}

function Get-XmlValue([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

# Installation root for the TTA MCP IIS application.
# The archive contents are placed under <root>\releases\<version>.
function Get-InstallRoot {
    param([string] $RequestedRoot, [string] $DefaultRoot, [string] $ApplicationLabel)
    $selected = $RequestedRoot
    if ([string]::IsNullOrWhiteSpace($selected)) {
        $selected = $DefaultRoot
    }
    $selected = $selected.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($selected)) { throw 'The installation root cannot be empty.' }
    Write-Host "$ApplicationLabel installation root: $selected" -ForegroundColor Cyan
    if (-not [IO.Path]::IsPathFullyQualified($selected) -or $selected -notmatch '^[A-Za-z]:\\') {
        throw 'Installation root must be an absolute local path, for example C:\Apps\MyApp. UNC and relative paths are not supported.'
    }
    $full = [IO.Path]::GetFullPath($selected).TrimEnd('\')
    $driveRoot = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    if ($full -ieq $driveRoot) { throw 'Installation root cannot be a drive root. Choose a dedicated directory.' }
    $windowsRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
    if ($full -ieq $windowsRoot -or
        $full.StartsWith($windowsRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $windowsRoot.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installation root cannot be inside the Windows directory or one of its ancestors.'
    }
    return $full
}

$installRootFull = Get-InstallRoot -RequestedRoot $InstallRoot -DefaultRoot 'C:\Apps\TTAMCP' -ApplicationLabel 'TTA MCP'
$stagingPath = $null
try {
    # Deployment can start directly from ZIP or from the original extracted directory.
    # Without a package override, choose the highest-version x64 ZIP beside this installer.
    $scriptRootSource = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
    $archiveInput = $PackagePath
    if ([string]::IsNullOrWhiteSpace($archiveInput) -and -not (Test-Path -LiteralPath (Join-Path $scriptRootSource 'runtime.json') -PathType Leaf)) {
        $packages = @(
            Get-ChildItem -LiteralPath $scriptRootSource -File -Filter 'tta-mcp-server-iis-*-windows-x64.zip' -ErrorAction SilentlyContinue |
                ForEach-Object {
                    if ($_.BaseName -match '^tta-mcp-server-iis-(?<version>\d+\.\d+\.\d+)-windows-x64$') {
                        [PSCustomObject]@{
                            File = $_
                            Version = [version]$Matches.version
                        }
                    }
                }
        )
        if ($packages.Count -eq 0) {
            throw "No TTA MCP Windows x64 release ZIP was found beside '$PSCommandPath'. Copy Install-TTA-MCP.ps1 and a release ZIP into the same folder, or pass -PackagePath."
        }
        $selectedPackage = $packages | Sort-Object -Property @{ Expression = 'Version'; Descending = $true }, @{ Expression = { $_.File.LastWriteTimeUtc }; Descending = $true } | Select-Object -First 1
        $archiveInput = $selectedPackage.File.FullName
        Write-Host "Selected latest application package v$($selectedPackage.Version): $archiveInput" -ForegroundColor Cyan
    }
    if (-not [string]::IsNullOrWhiteSpace($archiveInput)) {
        $zipFile = (Resolve-Path -LiteralPath $archiveInput -ErrorAction Stop).Path
        if ([IO.Path]::GetExtension($zipFile) -ine '.zip') { throw 'PackagePath must point to a .zip file.' }
        $stagingPath = Join-Path ([IO.Path]::GetTempPath()) ('TtaMcp-IIS-install-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
        Expand-Archive -LiteralPath $zipFile -DestinationPath $stagingPath -ErrorAction Stop
        $sourceRoot = $stagingPath
        # Accept archives with a single top-level wrapper directory.
        if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime.json') -PathType Leaf)) {
            $topDirs = @(Get-ChildItem -LiteralPath $stagingPath -Directory)
            $topFiles = @(Get-ChildItem -LiteralPath $stagingPath -File)
            if ($topDirs.Count -eq 1 -and $topFiles.Count -eq 0 -and
                (Test-Path -LiteralPath (Join-Path $topDirs[0].FullName 'runtime.json') -PathType Leaf)) {
                $sourceRoot = $topDirs[0].FullName
            }
        }
    } else {
        $sourceRoot = $scriptRootSource
    }
$runtimeFile = Join-Path $sourceRoot 'runtime.json'
$templateFile = Join-Path $sourceRoot 'deploy\iis\web.config.template'
if (-not (Test-Path -LiteralPath $runtimeFile)) { throw 'runtime.json is missing. Extract the complete IIS ZIP package before deploying.' }
if (-not (Test-Path -LiteralPath $templateFile)) { throw 'IIS web.config template is missing from the package.' }
if (-not (Test-Path -LiteralPath $NodeExePath -PathType Leaf)) { throw "Node.js was not found at '$NodeExePath'. Install the required x64 Node.js runtime or pass -NodeExePath." }

$runtimeInfo = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
if ($runtimeInfo.platform -ne 'win32' -or $runtimeInfo.arch -ne 'x64') { throw 'This package is not a Windows x64 build.' }
if (([string]$runtimeInfo.appVersion) -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw 'Invalid release version in runtime.json.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'dist\server\index.js') -PathType Leaf)) {
    throw 'Compiled server entry point dist/server/index.js is missing from the package.'
}
$nodeVersion = (& $NodeExePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(22|24)\.(\d+)\.(\d+)$') {
    throw 'Node.js 22.15+ or Node.js 24 x64 is required.'
}
$nodeMajor = [int]$Matches[1]
$nodeMinor = [int]$Matches[2]
if ($nodeMajor -eq 22 -and $nodeMinor -lt 15) { throw 'Node.js 22.15+ is required for Node.js 22 releases.' }
if ($nodeMajor -ne [int]$runtimeInfo.nodeMajor) { throw "This package requires Node.js major $($runtimeInfo.nodeMajor); found $nodeVersion." }
$nodeArch = (& $NodeExePath -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $nodeArch -ne 'x64') { throw "Node.js x64 is required; detected '$nodeArch'." }

$applicationPath = '/' + $ApplicationPath.Trim('/')
if ($applicationPath -notmatch '^/[A-Za-z0-9_-]+$') { throw 'ApplicationPath must be one IIS path segment, for example /tta-mcp.' }
$AppPoolName = $AppPoolName.Trim()
if ($AppPoolName -notmatch '^[A-Za-z0-9_.-]{1,64}$') { throw 'AppPoolName may contain only letters, numbers, dot, underscore and hyphen (maximum 64 characters).' }
$applicationName = $applicationPath.TrimStart('/')
$basePath = $applicationPath

Initialize-IisNative
Initialize-IisPoolApi
if ($ServiceAccount -and $UseApplicationPoolIdentity) { throw 'Do not combine -ServiceAccount with -UseApplicationPoolIdentity.' }
$website = Get-IisSite -Name $SiteName
if ($null -eq $website) { throw "IIS site '$SiteName' was not found." }
if ($website.GetAttribute('state') -ne 'Started') { throw "IIS site '$SiteName' must be started." }
# The application base path is fixed by this deployment; the hostname comes from IIS.
$origin = Get-IisHttpsOrigin -Site $website -RequestedHost $ServerHost
Write-Host "Target application URL: $origin$applicationPath/" -ForegroundColor Cyan

$iisModules = @(Get-IisObjects -Entity 'module')
if (-not ($iisModules | Where-Object { $_.GetAttribute('MODULE.NAME') -ieq 'httpPlatformHandler' })) {
    throw 'HttpPlatformHandler is not installed/enabled in IIS. This Node.js IIS package requires that separate native IIS module; installing IIS Management Tools is not sufficient.'
}

# Validate the target IIS app BEFORE changing any app pool identity or filesystem ACL.
$existingApp = Get-IisApplication -SiteName $SiteName -ApplicationName $applicationName
if ($null -ne $existingApp) {
    $oldPhysicalPath = [IO.Path]::GetFullPath((Get-IisPhysicalPath -SiteName $SiteName -ApplicationName $applicationName)).TrimEnd('\')
    if (-not ($oldPhysicalPath.Equals($installRootFull, [StringComparison]::OrdinalIgnoreCase) -or
               $oldPhysicalPath.StartsWith($installRootFull + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw "IIS application $applicationPath already points outside '$installRootFull'; refusing to repoint an unrelated application."
    }
}

# Validate filesystem layout and version BEFORE changing IIS state or permissions.
$dataRootFull = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'TTA MCP IIS')).TrimEnd('\')
if ($installRootFull -ieq $dataRootFull -or
    $installRootFull.StartsWith($dataRootFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $dataRootFull.StartsWith($installRootFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installation root and TTA MCP data/log directory must be separate, neither containing the other.'
}
$releasesRoot = Join-Path $installRootFull 'releases'
$releasePath = Join-Path $releasesRoot ([string]$runtimeInfo.appVersion)
if ($sourceRoot -ne [IO.Path]::GetFullPath($releasePath).TrimEnd('\') -and
    ($installRootFull.Equals($sourceRoot, [StringComparison]::OrdinalIgnoreCase) -or
     $installRootFull.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase))) {
    throw 'The installation root must not be inside the unpacked source package. Choose a separate destination folder.'
}
$reuseExistingRelease = $false
if ($sourceRoot -ne [IO.Path]::GetFullPath($releasePath).TrimEnd('\') -and (Test-Path -LiteralPath $releasePath)) {
    $sourceEntry = Join-Path $sourceRoot 'dist\server\index.js'
    $existingEntry = Join-Path $releasePath 'dist\server\index.js'
    if (-not (Test-Path -LiteralPath $existingEntry -PathType Leaf) -or
        (Get-FileHash -LiteralPath $sourceEntry -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $existingEntry -Algorithm SHA256).Hash) {
        throw "Release folder already exists with different or incomplete application files: $releasePath. Existing releases are never overwritten."
    }
    # A retry with the same package is safe after a failed first health check; keep the release immutable.
    $reuseExistingRelease = $true
}

$targetAppIdentity = "$SiteName/$applicationName"
Ensure-IisAppPool -PoolName $AppPoolName -TargetApp $targetAppIdentity -AlwaysRunning
$previousPrincipal = Get-IisPoolPrincipal -PoolName $AppPoolName
Set-IisPoolAccount -PoolName $AppPoolName -ServiceAccount $ServiceAccount -UseApplicationPoolIdentity:$UseApplicationPoolIdentity
$poolPrincipal = Get-IisPoolPrincipal -PoolName $AppPoolName

New-Item -ItemType Directory -Path $releasesRoot -Force | Out-Null
if ($sourceRoot -ne [IO.Path]::GetFullPath($releasePath).TrimEnd('\') -and -not $reuseExistingRelease) {
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
    Invoke-Icacls $protectedDirectory @('/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)(F)', '*S-1-5-32-544:(OI)(CI)(F)', "${poolPrincipal}:(OI)(CI)(M)")
    Remove-PreviousDataAccess -Path $protectedDirectory -PreviousAccount $previousPrincipal -NewAccount $poolPrincipal
}

Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
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

Invoke-Icacls $releasePath @('/grant', "${poolPrincipal}:(OI)(CI)(RX)", '/T', '/C')

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

Set-IisApplicationDeployment -SiteName $SiteName -ApplicationName $applicationName -ReleasePath $releasePath -PoolName $AppPoolName -Preload
Start-Or-RecycleIisPool -PoolName $AppPoolName -RecycleIfStarted

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
Write-Output "IIS site/application: $SiteName$applicationPath"
Write-Output "App pool: $AppPoolName (identity: $poolPrincipal)"
Write-Output "Admin UI: $origin$basePath/"
Write-Output "Health:   $healthUrl"
Write-Output "MCP URL:  $origin$basePath/tta-mcp"
if ($health) { Write-Output 'Health check: ready' } else { Write-Warning "The app did not answer the HTTPS health check yet. Review IIS/HttpPlatformHandler logs in '$logDirectory'." }

if ($health -and $health.status -eq 'ready') {
    try {
        $live = Invoke-RestMethod -Uri "$origin$basePath/health/live" -Method Get -TimeoutSec 5
        if ([string]$live.version -ne [string]$runtimeInfo.appVersion) {
            throw 'The IIS HTTPS endpoint returned a different application version than the deployed package.'
        }
        Write-Output "Version:  $($live.version)"
        $setup = Invoke-RestMethod -Uri "$origin$basePath/api/setup" -Method Get -TimeoutSec 5
        if (-not $setup.required) {
            Write-Output 'Initial administrator already exists; sign in with the existing account.'
        } elseif ($setup.setupCodeRequired) {
            Write-Warning 'The deployed app still requires a local setup code. Check that the IIS package enables TTA_IIS_FIRST_RUN_SETUP and recycle the application pool.'
        } else {
            Write-Output "First administrator setup: $origin$basePath/ (open this HTTPS URL in a browser)."
        }
    } catch {
        Write-Warning 'Could not verify first-run setup through the IIS HTTPS URL. Review the health endpoint and IIS/HttpPlatformHandler logs.'
    }
}

} finally {
    if ($stagingPath -and (Test-Path -LiteralPath $stagingPath)) {
        Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}
