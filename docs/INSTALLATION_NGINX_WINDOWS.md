# HTTPS přes Nginx na Windows Serveru

Tento postup vystaví TTA MCP Server na `https://<název-serveru>:8543`. Nginx předává požadavky na aplikaci dostupnou výhradně přes `127.0.0.1:8380`; tento interní port se do sítě neotevírá.

> Oficiální Nginx pro Windows je podle dokumentace projektu beta implementace s omezenou škálovatelností. Pro větší nebo kritický produkční provoz zvažte Linux Nginx nebo Windows IIS/HTTP.sys. Níže uvedená konfigurace je pro Windows pilotní provoz.

## 1. Požadavky

- Hotový TTA MCP Windows ZIP rozbalený a funkční podle [instalace Windows](INSTALLATION_WINDOWS.md).
- Nginx pro Windows rozbalený například do `C:\Apps\nginx`.
- Nginx alespoň 1.19.4 (kvůli odmítnutí neznámého TLS SNI); pro TLS 1.3 musí být sestaven s OpenSSL 1.1.1 nebo novějším.
- OpenSSL CLI dostupné jako `openssl.exe`; ověřte `openssl version`.
- PFX certifikát, který obsahuje privátní klíč a jeho heslo.
- DNS jméno v SAN certifikátu, které klienti použijí. Tento název musí být dosažitelný z MCP klientů.
- PowerShell 7. Nginx a DPAPI pipe broker musí běžet pod stejným Windows účtem.

Nginx oficiálně očekává certifikát i privátní klíč ve formátu PEM, nikoliv `.pfx`. Heslo PFX nezadávejte jako argument příkazu; OpenSSL si ho vyžádá skrytým vstupem. Soubor `password.txt` je čitelný plaintext a Nginx ho nebude používat. Po převodu jeho obsah bezpečně uložte do správce hesel a čitelnou kopii odstraňte.

## 2. Převod PFX na certifikát a šifrovaný klíč

Otevřete PowerShell 7 pod účtem, pod kterým bude běžet Nginx. Příkazy pro OpenSSL heslo nevypisují do terminálu; při výzvě zadejte heslo PFX a poté nové heslo pro exportovaný PEM klíč:

```powershell
openssl pkcs12 -in C:/Apps/Certificates/server.pfx -clcerts -nokeys -out C:/Apps/Certificates/server-leaf.pem
openssl pkcs12 -in C:/Apps/Certificates/server.pfx -cacerts -nokeys -out C:/Apps/Certificates/server-chain.pem
openssl pkcs12 -in C:/Apps/Certificates/server.pfx -nocerts -aes256 -out C:/Apps/Certificates/server-encrypted.key
```

Třetí příkaz se po importním hesle PFX zeptá na nové heslo PEM klíče dvakrát. Použijte dlouhé náhodné heslo. Toto nové heslo nebude stejné jako heslo PFX.

Spojte certifikát a případné mezilehlé certifikáty v pořadí leaf, potom intermediates:

```powershell
$leaf = Get-Content -LiteralPath 'C:\Apps\Certificates\server-leaf.pem' -Raw
$chain = Get-Content -LiteralPath 'C:\Apps\Certificates\server-chain.pem' -Raw
$fullChain = $leaf.Trim() + "`r`n" + $chain.Trim() + "`r`n"
[IO.File]::WriteAllText('C:\Apps\Certificates\server-fullchain.pem', $fullChain, [Text.Encoding]::ASCII)
openssl x509 -in C:/Apps/Certificates/server-leaf.pem -noout -subject -ext subjectAltName -dates
```

Ověřte, že `subjectAltName` obsahuje přesně DNS jméno, které dále dosadíte do konfigurace. Pokud PFX neobsahuje mezilehlý certifikát, získejte jej od správce CA a připojte za leaf certifikát. Nginx vyžaduje PEM a řetězec v pořadí leaf před intermediates.

Uložte heslo PEM klíče do DPAPI úložiště účtu Nginx, nikoliv do souboru s čitelným heslem:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& 'C:\Apps\tta-mcp-server\releases\0.2.10\deploy\nginx\windows\Protect-NginxPassphrase.ps1'
```

Windows ZIP obsahuje složku `deploy`. Skript se bezpečně zeptá na nové heslo šifrovaného PEM klíče a uloží pouze DPAPI šifrovanou hodnotu do `%LOCALAPPDATA%\TTA MCP Server\nginx-secrets`. DPAPI je svázané s aktuálním Windows účtem; Nginx a pipe broker proto musí běžet pod tímto účtem.

Nastavte NTFS ACL také na certifikáty a klíč. Následující příklad ponechá čtení účtu Nginx, SYSTEM a správcům; upravte proměnnou identity podle použitého účtu:

```powershell
$nginxAccount = "$env:USERDOMAIN\$env:USERNAME"
icacls 'C:\Apps\Certificates\server-encrypted.key' /inheritance:r /grant:r "${nginxAccount}:R" '*S-1-5-18:R' '*S-1-5-32-544:R'
icacls 'C:\Apps\Certificates\server-fullchain.pem' /inheritance:r /grant:r "${nginxAccount}:R" '*S-1-5-18:R' '*S-1-5-32-544:R'
```

## 3. Nastavení MCP serveru

Pokud ještě nebyl vytvořen první správce, nejprve ho vytvořte přes `http://127.0.0.1:8380`, dokud je aplikace v původním lokálním režimu. Instalační kód je dostupný jen při přímém lokálním přístupu. Potom použijte skutečný certifikátový DNS název místo `<mcp-host>` a nastavte veřejný origin pro aplikaci. PowerShell spusťte jako správce:

```powershell
[Environment]::SetEnvironmentVariable('TTA_PUBLIC_ORIGIN', 'https://<mcp-host>:8543', 'Machine')
[Environment]::SetEnvironmentVariable('TTA_COOKIE_SECURE', 'true', 'Machine')
```

Restartujte úlohu TTA MCP Serveru, aby načetla nové proměnné. Od tohoto okamžiku už konzoli používejte přes HTTPS.

## 4. Nginx konfigurace

Zkopírujte [`tta-mcp-server.conf`](../deploy/nginx/windows/tta-mcp-server.conf) do `C:\Apps\nginx\conf\tta-mcp-server.conf`. Změňte `server_name` na DNS jméno v SAN certifikátu. Cesty PEM souborů upravte, pokud jste je uložili jinam. Soubor vložte dovnitř existujícího bloku `http { ... }` v `C:\Apps\nginx\conf\nginx.conf`:

```nginx
include conf/tta-mcp-server.conf;
```

V souboru zůstává cesta k pojmenované rouře `//./pipe/TTAMCPNginxPassphrase`. Skript `Serve-NginxPassphrasePipe.ps1` ji obsluhuje z DPAPI uloženého hesla v paměti. Spusťte ji jako dlouho běžící Plánovanou úlohu při startu Windows:

- Program: `C:\Program Files\PowerShell\7\pwsh.exe`
- Argumenty: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Apps\tta-mcp-server\releases\0.2.10\deploy\nginx\windows\Serve-NginxPassphrasePipe.ps1"`
- Spustit jako: tentýž účet, který vytvořil DPAPI secret a pod kterým bude běžet Nginx.
- Spouštět při startu systému; povolit běh bez přihlášení.

Spusťte pipe broker, potom Nginx. Při každém `nginx -t` nebo reloadu musí broker běžet:

```powershell
Set-Location 'C:\Apps\nginx'
& '.\nginx.exe' -p 'C:/Apps/nginx/' -c 'conf/nginx.conf' -t
& '.\nginx.exe' -p 'C:/Apps/nginx/' -c 'conf/nginx.conf'
```

`nginx -t` musí skončit úspěšně. V Plánovači úloh vytvořte druhou úlohu:

- Spouštět při startu systému se zpožděním 15 sekund.
- Program: `C:\Apps\nginx\nginx.exe`
- Argumenty: `-p C:/Apps/nginx/ -c conf/nginx.conf`
- Spustit v: `C:\Apps\nginx`
- Účet: stejný jako pipe broker; povolte běh bez přihlášení.
- V nastavení úlohy nastavte opakování při selhání.

Nginx pro Windows není nativní služba. Po změně konfigurace použijte `nginx.exe -p C:/Apps/nginx/ -c conf/nginx.conf -s reload`; pipe broker musí běžet i během reloadu.

## 5. Firewall a ověření

Povolte pouze příchozí TCP 8543 z rozsahů, ze kterých se MCP klienti skutečně připojují. Pravidlo nevytvářejte pro celý internet, pokud to není potřeba:

```powershell
New-NetFirewallRule -DisplayName 'TTA MCP HTTPS 8543' -Direction Inbound -Protocol TCP -LocalPort 8543 -RemoteAddress '<povolene-CIDR>' -Action Allow
```

Port `8380` ponechte pouze na loopbacku a ve firewallu jej nezpřístupňujte. DNS název musí směřovat na tento server a klienti musejí důvěřovat interní CA.

Ověřte stav aplikace a HTTPS z klientského počítače. Nepoužívejte obcházení kontroly certifikátu:

```powershell
Invoke-RestMethod 'https://<mcp-host>:8543/health/ready'
```

Odpověď má uvádět `status: ready`. Poté otevřete `https://<mcp-host>:8543`, přihlaste se administrátorským účtem a v MCP klientovi použijte endpoint `https://<mcp-host>:8543/tta-mcp`. Připojení MCP musí mít vlastní bearer token vytvořený v administraci.

## Bezpečnostní provozní pravidla

- Nikdy nekonfigurujte `.pfx` přímo do `ssl_certificate`; Nginx potřebuje PEM certifikát a klíč.
- Nginx dostává heslo k PEM klíči při načtení konfigurace přes lokální pojmenovanou rouru. V souboru na disku zůstává pouze Windows DPAPI šifrovaná hodnota; runtime přístup vyžaduje tentýž účet Windows.
- Heslo k PFX ve `password.txt` je čitelný plaintext. Po převodu ho odstraňte z této cesty a uchovávejte ve správci hesel. Nepoužívejte jej jako heslo PEM klíče.
- Nezapisujte PFX heslo, PEM heslo ani obsah klíče do logu, argumentů procesů nebo repozitáře.
- `server_name`, SAN certifikátu a `TTA_PUBLIC_ORIGIN` musí mít stejný hostname. Origin obsahuje také port `8543`.
- Nginx access log nezapisuje query string ani autorizační hlavičky. Aplikační logy nadále redigují `Authorization`, cookies a `Set-Cookie`.
- Nginx konfigurace nepovoluje HTTP, TLS 1.0/1.1, TLS early data ani SNI s jiným názvem. HSTS se zapíná až na HTTPS vhostu.

## Zdroje

- [Nginx SSL modul](https://nginx.org/en/docs/http/ngx_http_ssl_module.html) – PEM formát, pořadí řetězce, heslo šifrovaného klíče, TLS a odmítnutí neznámého SNI.
- [Nginx proxy modul](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) – hlavičky, bufferování a timeouty reverzní proxy.
- [Nginx pro Windows](https://nginx.org/en/docs/windows.html) – podporované spuštění a provozní omezení Windows verze.
