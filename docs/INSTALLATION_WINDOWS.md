# Windows build a nasazení

Windows Server slouží pouze ke spuštění hotového balíčku. Kompilace TypeScriptu, Vite ani nativních npm modulů se na cílovém serveru neprovádí. Build vytvořte předem na Windows pracovní stanici a na server přeneste ZIP obsahující aplikaci i produkční závislosti.

Projekt je ověřován na Windows 10/11 x64. Windows Server není formálně ověřené prostředí; níže uvedený postup je určený pro pilotní instalaci. První vytvoření správce vyžaduje webový prohlížeč na serveru nebo připojení přes RDP.

## Co potřebuje buildovací stanice

Buildovací stanice je Windows x64 počítač, na kterém vznikne Windows ZIP. Použijte Node.js 24 LTS x64 nebo Node.js 22 LTS od verze 22.15. Výsledný balíček pak vyžaduje stejnou hlavní verzi Node.js.

- Git for Windows pouze pokud zdrojový kód získáváte přes `git clone`.
- Node.js x64 a npm.
- PowerShell 7 x64 a Windows `tar.exe`.
- Python 3 x64 a Visual Studio Build Tools 2022 s workloadem **Desktop development with C++**, MSVC x64/x86 a Windows SDK. Jsou potřeba, pokud npm pro nativní moduly `argon2` nebo `better-sqlite3` nenajde předkompilovaný balíček a přejde na sestavení přes `node-gyp`.
- Odchozí HTTPS/DNS přístup k GitHubu, `registry.npmjs.org` a `nodejs.org`.

Pro Python 3.12 nebo novější musí být použitý `node-gyp` verze 10 nebo novější. Při problému s výběrem Pythonu nastavte v PowerShellu cestu takto:

```powershell
$env:npm_config_python = (python -c "import sys; print(sys.executable)").Trim()
```

Podrobnosti jsou v [požadavcích node-gyp pro Windows](https://github.com/nodejs/node-gyp#on-windows).

## 1. Vytvořte hotový ZIP na pracovní stanici

Na stanici otevřete PowerShell 7 v kořeni projektu a spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
node --version
node -p "process.arch"
.\New-Build.ps1
```

Build vytvoří výstup mimo OneDrive v `C:\Temp\TTAMCP-Build`. Pro Windows Server použijte soubor:

```text
C:\Temp\TTAMCP-Build\tta-mcp-server-<verze>-windows-x64.zip
```

ZIP obsahuje zkompilované `dist`, hotové produkční `node_modules`, launcher `Run-Local.ps1` a `runtime.json` s požadovanou hlavní verzí Node.js a architekturou. Vedle něj vzniká také `.tgz` pro Linux VM; tento Linux artefakt není určen pro Windows Server.

Přeneste Windows ZIP na server schváleným způsobem, například přes RDP přesměrovanou jednotku, zabezpečené sdílení nebo SFTP. Zdrojový repozitář na server kopírovat nemusíte.

## 2. Co nainstalovat na Windows Server

Na serveru stačí:

- **Windows Server 2016 nebo novější** pro podporované oficiální Node.js x64 binárky. Aplikace přesto zatím není na Windows Serveru formálně ověřená.
- **Node.js x64** se stejnou hlavní verzí, jakou uvádí `runtime.json` v ZIPu. Instalátor MSI zahrnuje potřebný `node.exe`.
- **PowerShell 7 x64**, protože ho používají launcher a Plánovač úloh.
- **Microsoft Visual C++ v14 Redistributable x64** pro nativní runtime knihovny použitých modulů. Nainstalujte nejnovější podporovanou verzi z [oficiální stránky Microsoftu](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).
- Přístup k TTA endpointu a lokální prohlížeč/RDP pro první nastavení.

Na Windows Serveru není potřeba Git, Python, Visual Studio Build Tools, npm instalace závislostí, přístup k npm registru ani kompilátor. C++ Redistributable obsahuje runtime knihovny pro aplikace vytvořené pomocí MSVC; architektura musí odpovídat aplikaci. Oficiální Node.js x64 podporuje Windows Server 2016 a novější ([platformy Node.js](https://github.com/nodejs/node/blob/main/BUILDING.md#platform-list)). [Node.js pro Windows](https://nodejs.org/en/download) a [instalace PowerShellu 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows). Na starších verzích Windows Serveru nemusí být `winget`; použijte MSI instalátory.

## 3. Rozbalte balíček a spusťte ho

V následujícím příkladu upravte cestu k přenesenému ZIPu a číslo verze. Každou verzi rozbalte do nové složky, abyste při aktualizaci zachovali předchozí vydání pro návrat:

```powershell
$zip = 'C:\Transfer\tta-mcp-server-0.2.8-windows-x64.zip'
$release = 'C:\Apps\tta-mcp-server\releases\0.2.8'
New-Item -ItemType Directory -Path $release -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $release
Get-Content (Join-Path $release 'runtime.json')
node --version
node -p "process.arch"
```

Ověřte, že `runtime.json` uvádí `platform: win32`, `arch: x64` a `nodeMajor` odpovídající nainstalované verzi Node.js. Launcher tyto hodnoty při spuštění kontroluje.

Spusťte aplikaci pod Windows účtem, pod kterým má trvale běžet:

```powershell
Set-Location 'C:\Apps\tta-mcp-server\releases\0.2.8'
Set-ExecutionPolicy -Scope Process Bypass -Force
.\Run-Local.ps1 -Portable
```

`-Portable` spustí rozbalený předpřipravený balíček přímo. Nevolá build ani npm. Na serveru otevřete `http://127.0.0.1:8380`, zadejte jednorázový kód z prvního spuštění a vytvořte správce s heslem alespoň 12 znaků. Potom ověřte připravenost:

```powershell
Invoke-RestMethod http://127.0.0.1:8380/health/ready
```

Odpověď má obsahovat `status: ready` a `database: ok`. `Ctrl+C` aplikaci zastaví.

## 4. Spuštění po restartu serveru

Po prvním ručním přihlášení vytvořte úlohu v Plánovači úloh (`taskschd.msc`):

1. Zvolte **Vytvořit úlohu**. Nastavte stejný Windows účet, který provedl první spuštění, a povolte spuštění bez přihlášení uživatele.
2. Přidejte aktivační událost **Při spuštění systému**.
3. Přidejte akci:
   - Program: `C:\Program Files\PowerShell\7\pwsh.exe`
   - Argumenty: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Apps\tta-mcp-server\releases\0.2.8\Run-Local.ps1" -Portable`
   - **Spustit v**: `C:\Apps\tta-mcp-server\releases\0.2.8`
4. Uložte úlohu a spusťte ji ručně. Ověřte `/health/ready`.

Při aktualizaci nejprve zastavte úlohu, rozbalte novou verzi do nové složky `releases`, změňte cestu v akci úlohy na nový `Run-Local.ps1` a úlohu znovu spusťte. Předchozí release ponechte, dokud novou verzi neověříte. Data a klíč zůstávají mimo release složky.

## Síť a bezpečné uložení

- Aplikace naslouchá pouze na `127.0.0.1:8380`. Port 8380 neotvírejte přímo ve Windows Firewallu. Pro vzdálený přístup použijte HTTPS reverzní proxy na stejném serveru nebo bezpečný tunel.
- Pro interní certifikát TTA nainstalujte ověřenou kořenovou CA do **Local Computer → Trusted Root Certification Authorities**. Launcher předává Node.js důvěryhodné CA z Windows.
- Databáze a DPAPI chráněný vault klíč jsou v `%LOCALAPPDATA%\TTA MCP Server` účtu, který aplikaci spouští. TTA hesla a `SYSTEM_SESSION_ID` se šifrují AES-256-GCM; heslo správce se ukládá jako Argon2id hash.
- Naplánovaná úloha musí běžet pod stejným Windows účtem jako první spuštění. Změna účtu znepřístupní DPAPI klíč. Zálohujte databázi i klíč společně a šifrovaně.

## Vývojářské spuštění přímo ze zdrojů

Pokud chcete aplikaci vyvíjet nebo sestavovat přímo na tomto počítači, postupujte podle požadavků pro buildovací stanici výše a spusťte `New-Build.ps1` následované `Run-Local.ps1` bez přepínače `-Portable`. Tento postup není potřeba na cílovém Windows Serveru.
