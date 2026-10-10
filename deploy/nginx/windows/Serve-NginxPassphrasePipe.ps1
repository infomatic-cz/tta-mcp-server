[CmdletBinding()]
param(
    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'TTA MCP Server\nginx-secrets\key-passphrase.dpapi'),
    [string]$PipeName = 'TTAMCPNginxPassphrase'
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This script requires Windows named pipes and DPAPI.' }
if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) { throw "DPAPI passphrase file not found: $SecretPath" }

$options = [IO.Pipes.PipeOptions]::CurrentUserOnly
$encoding = [Text.UTF8Encoding]::new($false)
$ciphertext = [IO.File]::ReadAllText([IO.Path]::GetFullPath($SecretPath)).Trim()
if (-not $ciphertext) { throw 'The DPAPI passphrase file is empty.' }

while ($true) {
    $pipe = [IO.Pipes.NamedPipeServerStream]::new(
        $PipeName,
        [IO.Pipes.PipeDirection]::Out,
        1,
        [IO.Pipes.PipeTransmissionMode]::Byte,
        $options
    )
    try {
        $pipe.WaitForConnection()
        $secure = ConvertTo-SecureString -String $ciphertext
        $ptr = [IntPtr]::Zero
        $characters = $null
        $utf8 = $null
        $bytes = $null
        try {
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            $characters = [char[]]::new($secure.Length)
            [Runtime.InteropServices.Marshal]::Copy($ptr, $characters, 0, $characters.Length)
            $utf8 = $encoding.GetBytes($characters)
            $bytes = [byte[]]::new($utf8.Length + 1)
            [Array]::Copy($utf8, $bytes, $utf8.Length)
            $bytes[$bytes.Length - 1] = 10
            $pipe.Write($bytes, 0, $bytes.Length)
            $pipe.Flush()
        }
        finally {
            if ($characters) { [Array]::Clear($characters, 0, $characters.Length) }
            if ($utf8) { [Array]::Clear($utf8, 0, $utf8.Length) }
            if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
            if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
            if ($secure) { $secure.Dispose() }
            $characters = $null
            $utf8 = $null
            $bytes = $null
        }
    }
    catch [IO.IOException] {
        # Nginx may close the pipe as soon as it has read the passphrase.
    }
    finally {
        if ($pipe) { $pipe.Dispose() }
    }
}
