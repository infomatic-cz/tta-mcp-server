# Instalace TTA MCP IIS na Windows Server

Tato varianta hostuje webovou aplikaci přímo jako IIS aplikaci. HTTPS vazbu a port 443 obsluhuje IIS. HttpPlatformHandler spouští Node.js proces a předává mu interní dynamický port; není potřeba Nginx, ARR ani samostatný veřejný port MCP serveru. Microsoft dokumentuje HttpPlatformHandler jako IIS modul pro správu HTTP procesů včetně Node.js: [HttpPlatformHandler – konfigurace](https://learn.microsoft.com/en-us/iis/extensions/httpplatformhandler/httpplatformhandler-configuration-reference).

## 1. Vytvoření balíčku na pracovní stanici

Na pracovní stanici s Windows x64 nainstalujte Node.js 22.15+ nebo 24 LTS x64 a PowerShell 7. Build závislostí může potřebovat Python 3 a Visual Studio Build Tools 2022 s C++ workloadem, pokud npm nemá předpřipravené nativní balíčky.

V kořeni tohoto zdrojového projektu spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\New-Build.ps1
```

Hotový ZIP vznikne mimo OneDrive:

```text
C:\Temp\TTAMCP-Build\IIS\tta-mcp-server-iis-0.3.1-windows-x64.zip
```

ZIP obsahuje zkompilovaný server, webové rozhraní, produkční Node závislosti, IIS šablonu a deploy skript. Build se na cílovém serveru nedělá.

## 2. Co musí být na cílovém serveru

Na Windows Serveru připravte:

- IIS 10 s HTTPS site bindingem na portu 443. Binding musí používat certifikát platný pro doménu, přes kterou se bude MCP otevírat.
- IIS Management Scripts and Tools, aby PowerShell mohl spravovat weby a aplikační pooly.
- **HttpPlatformHandler x64**. Nainstalujte MSI z [oficiální stránky IIS](https://learn.iis.net/downloads/microsoft/httpplatformhandler). Po instalaci ověřte modul v IIS Manageru nebo příkazem:

  ```powershell
  & "$env:windir\System32\inetsrv\appcmd.exe" list modules | Select-String HttpPlatformHandler
  ```

- Node.js x64 se stejnou hlavní verzí, jakou uvádí `runtime.json` v ZIPu. Návod níže předpokládá standardní umístění `C:\Program Files\nodejs\node.exe`.
- Microsoft Visual C++ v14 Redistributable x64 pro nativní npm moduly.
- DNS/síťový přístup serveru k API TotalAgility.

Na server se nekopírují zdroje, Git, Python ani Visual Studio Build Tools. Není potřeba instalovat npm závislosti.

## 3. Instalace aplikace do existující HTTPS site

Přeneste ZIP například do `C:\Transfer` a rozbalte jej do nové dočasné složky:

```powershell
$zip = 'C:\Transfer\tta-mcp-server-iis-0.3.1-windows-x64.zip'
$package = 'C:\Transfer\tta-mcp-iis-0.3.1'
New-Item -ItemType Directory -Path $package -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $package
Get-Content (Join-Path $package 'runtime.json')
node --version
node -p "process.arch"
```

Otevřete **PowerShell jako správce**, přejděte do rozbaleného balíčku a spusťte deploy. Hodnoty `SiteName` a `PublicOrigin` upravte podle IIS Manageru. `ApplicationPath` je nová IIS aplikace pod existujícím webem:

```powershell
Set-Location 'C:\Transfer\tta-mcp-iis-0.3.1'
Set-ExecutionPolicy -Scope Process Bypass -Force
.\Deploy-IIS.ps1 `
  -SiteName 'Default Web Site' `
  -ApplicationPath '/tta-mcp' `
  -PublicOrigin 'https://winserver-tta26.im.cz'
```

`PublicOrigin` musí přesně odpovídat HTTPS doméně IIS bindingu a certifikátu, bez cesty aplikace. Pokud například uživatelé otevírají TTA na `https://winserver-tta26.im.cz`, ponechte tuto adresu. IIS aplikace pak bude dostupná na:

```text
https://winserver-tta26.im.cz/tta-mcp/
```

Deploy skript vytvoří aplikační pool `TtaMcpIIS` s identitou ApplicationPoolIdentity, nastaví IIS aplikaci, její URL prefix, přístupová práva a `web.config`. Node.js proces spouští a spravuje IIS HttpPlatformHandler. Proces naslouchá pouze na interním dynamickém portu; ve Windows Firewallu se nemusí otevírat port 8380 ani 8543.

Při prvním nasazení skript vytvoří náhodný vault klíč, uloží jej zašifrovaný Windows DPAPI pro tento počítač a vypíše jednorázový instalační kód. Kód zadejte do webového rozhraní a založte účet správce s heslem alespoň 12 znaků. Kód platí 30 minut a po vytvoření účtu zanikne. Později se přihlašujte svým správcovským účtem. IIS pool používá identitu **ApplicationPoolIdentity** a 64bitový proces; skript jí udělí pouze potřebný přístup k datům, logům a vydané aplikaci.

Pokud skript vypíše, že health kontrola ještě neodpovídá, ověřte stav na `https://winserver-tta26.im.cz/tta-mcp/health/ready` a prohlédněte IIS/HttpPlatformHandler logy v:

```text
C:\ProgramData\TTA MCP IIS\logs
```

## 4. Ověření připojení a MCP klienta

Po přihlášení přidejte TTA připojení přes **TTA připojení → Přidat připojení**. Do TTA adresy zadejte skutečný TTA REST host a případný kontext, například `https://winserver-tta26.im.cz/TotalAgility`. `TTA_PUBLIC_ORIGIN` je naopak veřejná doména administračního MCP serveru.

Tlačítko **Test REST API** ověří přihlášení a session. V **MCP klienti** vytvořte token a zkopírujte zobrazenou MCP adresu; při aplikaci `/tta-mcp` bude obvykle:

```text
https://winserver-tta26.im.cz/tta-mcp/tta-mcp
```

Klient kromě této adresy potřebuje Bearer token. MCP nástroje zůstávají stejné jako v původním projektu.

## 5. Interní certifikát TTA

IIS certifikát řeší spojení uživatele s MCP aplikací. Spojení **MCP server → TTA REST API** je samostatné odchozí HTTPS spojení. Pokud TTA používá interní CA, nainstalujte její ověřený kořenový certifikát na Windows server do **Local Computer → Trusted Root Certification Authorities**. IIS konfigurace spouští Node.js s `--use-system-ca`, takže Node načte systémovou důvěru Windows. Ověření TLS nevypínejte.

Server musí také vyřešit DNS jméno TTA a mít síťový přístup na jeho HTTPS port. Hostování aplikace na stejném serveru samo o sobě neopraví chybný DNS záznam ani nedůvěryhodný certifikát.

## 6. Uložení dat a záloha

IIS data jsou oddělená od zdrojů a release balíčku:

```text
C:\ProgramData\TTA MCP IIS\data\tta-mcp.sqlite
C:\ProgramData\TTA MCP IIS\data\vault-key.dpapi
C:\ProgramData\TTA MCP IIS\logs
```

Přístup mají administrátoři, SYSTEM a příslušná identita IIS aplikačního poolu. Soubor `vault-key.dpapi` obsahuje pouze DPAPI LocalMachine šifrovaný klíč. Node.js si jej při spuštění načte přes Windows DPAPI do paměti; nešifrovaný klíč se do souboru ani `web.config` nezapisuje. TTA hesla a `SYSTEM_SESSION_ID` zůstávají šifrované AES-256-GCM v SQLite.

Zálohujte databázi a DPAPI soubor společně a chraňte zálohu. DPAPI LocalMachine je svázané s konkrétním Windows serverem; kopie souborů na jiný server sama o sobě nestačí k dešifrování. Pro konzistentní zálohu zastavte nebo recyklujte aplikační pool před kopií databáze.

## 7. Aktualizace a návrat

Rozbalte novou verzi do nové dočasné složky a spusťte její `Deploy-IIS.ps1` se stejnými parametry. Skript zkopíruje release do nové složky pod `C:\Apps\TTA MCP IIS\releases\<verze>` a přesměruje IIS aplikaci na novou verzi. Databáze a DPAPI klíč pod `%ProgramData%` zůstanou zachované; starší release se nemaže.

Před aktualizací poznamenejte cestu `Physical Path` aplikace v IIS Manageru. Při návratu nastavte její `Physical Path` na předchozí složku `releases\<verze>` a recyklujte `TtaMcpIIS` app pool.

## Diagnostika

- **HTTP 500.21 / modul není rozpoznán:** HttpPlatformHandler x64 není nainstalovaný nebo nebyl po instalaci restartován IIS.
- **HTTP 502.3 / backend nedostupný:** zkontrolujte Node.js, Visual C++ Redistributable a soubory v `%ProgramData%\TTA MCP IIS\logs`.
- **HTTP 403 Nepovolený Host:** `PublicOrigin` musí odpovídat hostu v prohlížeči a HTTPS bindingu.
- **Nelze načíst vault key:** ověřte, že IIS app pool má přístup k `vault-key.dpapi` a že deploy skript spouštíte pod správcovským účtem.
- **TTA REST API není dosažitelné:** ověřte odchozí DNS/síť, TLS certifikát a důvěru kořenové CA v `Local Computer`.
