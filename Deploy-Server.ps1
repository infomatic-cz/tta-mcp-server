[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Server,

    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_.-]*$')]
    [string]$User = 'root',

    [string]$PublicOrigin
)

$ErrorActionPreference = 'Stop'
$buildRoot = 'C:\Temp\TTAMCP-Build'
$artifact = Join-Path $buildRoot 'tta-mcp-server-0.2.0.tgz'
$buildScript = Join-Path $PSScriptRoot 'New-Build.ps1'

if ($PublicOrigin) {
    $originUri = $null
    if (-not [Uri]::TryCreate($PublicOrigin, [UriKind]::Absolute, [ref]$originUri) -or $originUri.Scheme -ne 'https' -or $originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment) {
        throw 'PublicOrigin must be an HTTPS origin such as https://tta-mcp.example.cz.'
    }
}

foreach ($toolName in @('ssh.exe', 'scp.exe')) {
    if (-not (Get-Command $toolName -ErrorAction SilentlyContinue)) { throw "Required OpenSSH tool not found: $toolName" }
}
& $buildScript
if (-not (Test-Path -LiteralPath $artifact)) { throw "Build artifact not found: $artifact" }

$target = "$User@$Server"
$remoteArtifact = '/tmp/tta-mcp-server-0.2.0.tgz'
& scp.exe $artifact "${target}:$remoteArtifact"
if ($LASTEXITCODE -ne 0) { throw 'Could not copy the build archive to the VM.' }

$originValue = if ($PublicOrigin) { $PublicOrigin } else { '' }
$remoteInstall = @'
set -euo pipefail
PUBLIC_ORIGIN="$1"
ARCHIVE=/tmp/tta-mcp-server-0.2.0.tgz
APP_ROOT=/opt/tta-mcp-server
CONFIG_DIR=/etc/tta-mcp-server
DATA_DIR=/var/lib/tta-mcp-server
SERVICE_USER=tta-mcp-server

for command in node npm systemd-creds openssl tar runuser; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 20; }
done
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22 || major >= 25) process.exit(1)' || { echo 'Install Node.js 22 or 24 LTS system-wide first.' >&2; exit 21; }
systemd-creds --version >/dev/null
install -d -m 0755 "$APP_ROOT/releases"
install -d -m 0700 "$CONFIG_DIR"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$DATA_DIR"

RELEASE="$APP_ROOT/releases/$(date -u +%Y%m%d%H%M%S)"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$RELEASE"
tar -xzf "$ARCHIVE" -C "$RELEASE"
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE"
runuser -u "$SERVICE_USER" -- npm ci --omit=dev --no-audit --no-fund --prefix "$RELEASE"
ln -sfn "$RELEASE" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"

if [ ! -f "$CONFIG_DIR/vault-key.cred" ]; then
  openssl rand -base64 32 | systemd-creds encrypt --name=tta-vault-key - "$CONFIG_DIR/vault-key.cred" >/dev/null
  chmod 0600 "$CONFIG_DIR/vault-key.cred"
fi
if [ ! -f "$CONFIG_DIR/server.env" ]; then
  printf '%s\n' "TTA_PUBLIC_ORIGIN=$PUBLIC_ORIGIN" 'TTA_COOKIE_SECURE=false' > "$CONFIG_DIR/server.env"
  chmod 0600 "$CONFIG_DIR/server.env"
fi
install -m 0644 "$RELEASE/deploy/tta-mcp-server.service" /etc/systemd/system/tta-mcp-server.service
systemctl daemon-reload
systemctl enable tta-mcp-server.service
systemctl restart tta-mcp-server.service
rm -f "$ARCHIVE"
echo 'Deployment complete. The service listens only on 127.0.0.1:8380.'
'@

$remoteScriptPath = Join-Path $buildRoot 'remote-install.sh'
[IO.File]::WriteAllText($remoteScriptPath, $remoteInstall, [Text.UTF8Encoding]::new($false))
try {
    $remoteInstall | & ssh.exe $target "sudo -n bash -s -- '$originValue'"
    if ($LASTEXITCODE -ne 0) { throw 'Remote installation failed. Check sudo permissions and VM prerequisites.' }
} finally {
    if (Test-Path -LiteralPath $remoteScriptPath) { Remove-Item -LiteralPath $remoteScriptPath -Force }
}

Write-Output "Deployment complete on $Server. Complete first setup through an SSH tunnel before exposing the HTTPS reverse proxy."
