# Instalace TTA MCP IIS na Windows Server

Tato varianta hostuje webovou aplikaci přímo jako IIS aplikaci. HTTPS vazbu a port 443 obsluhuje IIS. HttpPlatformHandler spouští Node.js proces a předává mu dynamický interní port `%HTTP_PLATFORM_PORT%`; není potřeba Nginx, ARR ani samostatný veřejný port MCP serveru. Microsoft dokumentuje HttpPlatformHandler jako IIS modul pro správu HTTP procesů včetně Node.js: [HttpPlatformHandler – konfigurace](https://learn.microsoft.com/en-us/iis/extensions/httpplatformhandler/httpplatformhandler-configuration-reference).

## 1. Vytvoření balíčku na pracovní stanici

Na pracovní stanici s Windows x64 nainstalujte Node.js 22.15+ nebo 24 LTS x64 a PowerShell 7. Build závislostí může potřebovat Python 3 a Visual Studio Build Tools 2022 s C++ workloadem, pokud npm nemá předpřipravené nativní balíčky.

V kořeni tohoto zdrojového projektu spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\New-Build.ps1
```

Hotový ZIP vznikne mimo OneDrive:

```text
C:\Temp\TTAMCP-Build\IIS\tta-mcp-server-iis-0.3.4-windows-x64.zip
C:\Temp\TTAMCP-Build\IIS\Install-TTA-MCP.ps1
```

ZIP obsahuje zkompilovaný server, webové rozhraní, produkční Node závislosti a IIS šablonu. Samostatný `Install-TTA-MCP.ps1` se ukládá vedle ZIPu, takže jej není potřeba na serveru vybalovat z archivu. Build se na cílovém serveru nedělá.

## 2. Co musí být na cílovém serveru

Na Windows Serveru připravte:

- IIS 10 s HTTPS site bindingem na portu 443. Binding musí používat certifikát platný pro doménu, přes kterou se bude MCP otevírat.
- 64bitový PowerShell 7.0+ spuštěný jako správce.
- IIS Management Scripts and Tools, které poskytují vestavěné `AppCmd.exe` a `Microsoft.Web.Administration.dll`; modul WebAdministration není potřeba.
- **HttpPlatformHandler x64**. Nainstalujte MSI z [oficiální stránky IIS](https://learn.iis.net/downloads/microsoft/httpplatformhandler). Po instalaci ověřte modul v IIS Manageru nebo příkazem:

  ```powershell
  & "$env:windir\System32\inetsrv\appcmd.exe" list modules | Select-String HttpPlatformHandler
  ```

- Node.js x64 se stejnou hlavní verzí, jakou uvádí `runtime.json` v ZIPu. Návod níže předpokládá standardní umístění `C:\Program Files\nodejs\node.exe`.
- Microsoft Visual C++ v14 Redistributable x64 pro nativní npm moduly.
- DNS/síťový přístup serveru k API TotalAgility.

Na server se nekopírují zdroje, Git, Python ani Visual Studio Build Tools. Není potřeba instalovat npm závislosti.

## 3. Instalace aplikace do existující HTTPS site

Přeneste ZIP i samostatný `Install-TTA-MCP.ps1` například do stejné složky `C:\Transfer`. ZIP nerozbalujte; instalátor jej bezpečně rozbalí do dočasné složky a po nasazení ji uklidí. Na serveru otevřete 64bitový PowerShell 7 jako správce a spusťte:

```powershell
Set-Location 'C:\Transfer'
Set-ExecutionPolicy -Scope Process Bypass -Force
.\Install-TTA-MCP.ps1
```

Bez parametrů instalátor vyhledá vedle sebe ZIP `tta-mcp-server-iis-<verze>-windows-x64.zip` s nejvyšším číslem verze. Výchozí hodnoty jsou:

- IIS web: `Default Web Site`
- Aplikační cesta: `/tta-mcp`
- Kořen vydání: `C:\Apps\TTAMCP` (konkrétní verze se ukládá do `releases\<verze>`)

Skript odvodí hostname z existující HTTPS vazby. Při několika hostnames zvolí první HTTPS binding; při bindingu bez hostname použije DNS jméno počítače. Pokud certifikát používá jiný hostname, předejte `-ServerHost`. Jednotlivé výchozí hodnoty lze přepsat parametry `-PackagePath`, `-SiteName`, `-ApplicationPath`, `-InstallRoot` a `-ServerHost`. Skript nevytváří ani nemění IIS web, HTTPS binding, certifikát nebo port. Aplikace pak bude dostupná na:

```text
https://winserver-tta26.im.cz/tta-mcp/
```

Instalační skript vytvoří aplikační pool `TtaMcpIIS`, nastaví URL prefix, přístupová práva a `web.config`. Výchozí identita nového poolu je ApplicationPoolIdentity; při aktualizaci se existující identita zachová. Volitelně lze použít `-ServiceAccount 'DOMENA\svc_tta_mcp'`; heslo se zadá skrytým vstupem a IIS je uloží v chráněné konfiguraci. `-UseApplicationPoolIdentity` výslovně nastaví výchozí identitu. HttpPlatformHandler předá Node.js dynamický port přes `%HTTP_PLATFORM_PORT%`; port 8380 ani 8543 se ve firewallu neotevírá.

Při prvním nasazení skript vytvoří náhodný vault klíč a uloží jej chráněný Windows DPAPI pro tento počítač. Po HTTPS kontrole otevřete vypsanou adresu Admin UI přímo v prohlížeči a založte prvního správce s heslem alespoň 12 znaků. Průvodce funguje přes existující IIS HTTPS binding na portu 443; není potřeba otevírat ani použít port 8380. Po vytvoření prvního účtu se průvodce vypne a další přístup používá běžné přihlášení. IIS setup je dostupný jen dokud databáze neobsahuje správce, proto jej dokončete hned po instalaci a do té doby omezte přístup k webu na správce. Proces je 64bitový a skript udělí potřebná přístupová práva vybrané identitě aplikačního poolu.

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

Přeneste nový ZIP a samostatný `Install-TTA-MCP.ps1` do stejné složky. Instalátor automaticky vybere nejvyšší verzi nebo použijte `-PackagePath` pro konkrétní ZIP. Skript zkopíruje release do nové složky pod `C:\Apps\TTAMCP\releases\<verze>` a přesměruje IIS aplikaci na novou verzi. Databáze a DPAPI klíč pod `%ProgramData%` zůstanou zachované; starší release se nemaže. Pokud po prvním nasazení selže pouze readiness kontrola, opravte příčinu a spusťte instalátor znovu se stejným balíčkem: shodný existující release znovu použije a nepřepíše jeho soubory.

Před aktualizací poznamenejte cestu `Physical Path` aplikace v IIS Manageru. Při návratu nastavte její `Physical Path` na předchozí složku `releases\<verze>` a recyklujte `TtaMcpIIS` app pool.

## Diagnostika

- **HTTP 500.21 / modul není rozpoznán:** HttpPlatformHandler x64 není nainstalovaný nebo nebyl po instalaci restartován IIS.
- **HTTP 502.3 / backend nedostupný:** zkontrolujte Node.js, Visual C++ Redistributable a soubory v `%ProgramData%\TTA MCP IIS\logs`.
- **HTTP 403 Nepovolený Host:** hostname musí odpovídat vybrané HTTPS vazbě IIS.
- **Nelze načíst vault key:** ověřte, že IIS app pool má přístup k `vault-key.dpapi` a že deploy skript spouštíte pod správcovským účtem.
- **TTA REST API není dosažitelné:** ověřte odchozí DNS/síť, TLS certifikát a důvěru kořenové CA v `Local Computer`.
