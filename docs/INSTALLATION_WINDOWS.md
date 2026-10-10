# Instalace a spuštění ve Windows

Tento postup spouští aplikaci přímo ve Windows. Nepotřebuje WSL, Docker ani virtualizaci. První nastavení administračního účtu probíhá přes lokální webovou stránku, proto použijte Windows s desktopovým prostředím nebo se k serveru připojte přes RDP.

Projekt ověřuje Windows 10/11 x64. Windows Server není v této verzi samostatně ověřený ani formálně podporovaný; níže uvedený postup je určený pro pilotní instalaci na Windows Serveru.

## Co je třeba na novém stroji

- **Git for Windows**, pokud budete zdrojový kód stahovat příkazem `git clone`. Git není potřeba při buildu, pokud už zdrojový kód máte.
- **Node.js 24 LTS x64** včetně npm, případně Node.js 22 LTS od verze 22.15.
- **Python 3 x64**. Python musí být dostupný v `PATH`. Pro Python 3.12 nebo novější musí použitá verze `node-gyp` být alespoň 10.
- **Visual Studio Build Tools 2022** s workloadem **Desktop development with C++**. Vyberte také MSVC C++ x64/x86 build tools a Windows 10 nebo Windows 11 SDK.
- **PowerShell 7 x64** a Windows `tar.exe`.
- Odchozí HTTPS/DNS přístup k GitHubu, `registry.npmjs.org` a `nodejs.org` během stažení zdrojů, balíčků a případných Node.js hlaviček.

Python a C++ nástroje jsou potřeba proto, že závislosti `argon2` a `better-sqlite3` obsahují nativní moduly. Pokud pro přesnou kombinaci Node.js a Windows není dostupný předkompilovaný balíček, npm je sestaví přes `node-gyp`. Ten na Windows vyžaduje Python a Visual C++ build prostředí. [Požadavky node-gyp pro Windows](https://github.com/nodejs/node-gyp#on-windows)

## 1. Nainstalujte systémové nástroje

Nainstalujte aplikace pro všechny uživatele, pokud je instalátor nabízí. Po instalaci zavřete a znovu otevřete PowerShell, aby se obnovila proměnná `PATH`.

1. Nainstalujte [Git for Windows](https://git-scm.com/download/win). V instalátoru ponechte možnost používat Git z příkazového řádku.
2. Nainstalujte [Node.js 24 LTS](https://nodejs.org/en/download) pomocí Windows MSI. npm se instaluje společně s Node.js.
3. Nainstalujte [Python 3 pro Windows](https://www.python.org/downloads/windows/). Zapněte volbu **Add python.exe to PATH**.
4. Nainstalujte [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). V instalátoru vyberte workload **Desktop development with C++** a ověřte, že jsou vybrané MSVC x64/x86 build tools a Windows SDK.
5. Nainstalujte [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows) pomocí MSI. Na Windows Serveru 2022 a starším nemusí být k dispozici `winget`; použijte MSI.

V novém PowerShell 7 ověřte nástroje:

```powershell
node --version
npm --version
git --version
python --version
python -c "import sys; print(sys.executable)"
pwsh --version
tar.exe --version
```

Node.js musí být verze 22.15+ řady 22 LTS nebo řady 24 LTS. Pokud `python` nenajdete, opravte instalaci Pythonu nebo jeho `PATH` a otevřete nové PowerShell okno. Pokud se `node-gyp` netrefuje do správného Pythonu, nastavte jeho cestu pro aktuální okno podle zjištěného umístění:

```powershell
$env:npm_config_python = (python -c "import sys; print(sys.executable)").Trim()
```

`node-gyp` vyžaduje pro Python 3.12 a novější verzi 10 nebo novější. Pokud chyba uvádí nekompatibilní verzi `node-gyp`, aktualizujte Node.js a používejte npm dodané s touto instalací; starou globální instalaci npm/node-gyp nepoužívejte. [Podrobnosti k požadavkům node-gyp](https://github.com/nodejs/node-gyp#on-windows)

V **Visual Studio Installeru** lze instalaci Build Tools kdykoliv upravit: vyberte **Modify → Desktop development with C++** a doinstalujte MSVC x64/x86 a Windows SDK. Samotné Visual Studio Code tyto překladače neobsahuje.

## 2. Získejte zdrojový kód

Pokud zdrojový kód na serveru ještě není, otevřete PowerShell 7 a naklonujte repozitář:

```powershell
git clone https://github.com/infomatic-cz/tta-mcp-server.git C:\Apps\tta-mcp-server
Set-Location C:\Apps\tta-mcp-server
```

Jestli Git chybí, nainstalujte jej podle kroku 1, znovu otevřete PowerShell a ověřte `git --version`. Pokud zdrojový kód už máte, přejděte místo toho do jeho kořenové složky. Přístup k npm registru a GitHubu musí být povolen přes odchozí HTTPS.

## 3. Sestavte aplikaci mimo OneDrive

Z kořenové složky projektu spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\New-Build.ps1
```

Skript kopíruje zdroje do dočasného pracovního prostoru a sestavuje je pod `C:\Temp\TTAMCP-Build`. Do OneDrive se neinstalují Node závislosti ani se tam nevytváří build. První `npm ci` může několik minut trvat a použije Python/C++ nástroje, pokud npm musí přeložit nativní modul.

### Když build hlásí Python nebo node-gyp

- `gyp ERR! find Python` nebo `Could not find Python`: ověřte `python --version`, zkontrolujte cestu příkazem `python -c "import sys; print(sys.executable)"`, nastavte `$env:npm_config_python` podle kroku 1 a spusťte znovu `New-Build.ps1`.
- `Could not find any Visual Studio installation to use`: otevřete Visual Studio Installer a doinstalujte workload **Desktop development with C++**, MSVC x64/x86 a Windows SDK.
- `git is not recognized`: Git je potřeba pro klonování repozitáře. Po instalaci otevřete nové PowerShell okno. Pokud už zdrojový kód máte, můžete krok klonování přeskočit.
- Chyba stahování balíčku nebo Node hlaviček: ověřte odchozí HTTPS/DNS přístup k npm registru, GitHubu a `nodejs.org`, případně nastavení firemního proxy a důvěryhodné CA.

## 4. Spusťte aplikaci a vytvořte správce

Ve stejné složce a pod Windows účtem, pod kterým má aplikace běžet, spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\Run-Local.ps1
```

Počkejte, až skript vypíše adresu serveru. Na serveru otevřete v prohlížeči:

```text
http://127.0.0.1:8380
```

Na obrazovce prvního nastavení se zobrazí jednorázový kód. Zadejte jej a vytvořte správce s heslem o délce alespoň 12 znaků. Výchozí účet ani heslo neexistují. Při dalších spuštěních se přihlaste vytvořeným správcem. Proces ukončíte `Ctrl+C`.

Ověřte stav aplikace v dalším PowerShell okně:

```powershell
Invoke-RestMethod http://127.0.0.1:8380/health/ready
```

Očekávaná odpověď obsahuje `status: ready` a `database: ok`. Potom v konzoli aplikace přidejte TTA prostředí a spusťte **Test REST API**.

## 5. Automatické spuštění po restartu

`Run-Local.ps1` spouští aplikaci v aktuálním procesu; projekt neinstaluje nativní Windows službu. Pro spuštění po restartu serveru použijte Plánovač úloh:

1. Nejprve dokončete ruční první spuštění a vytvoření správce.
2. Otevřete `taskschd.msc` a vyberte **Vytvořit úlohu**.
3. Na kartě **Obecné** nastavte tentýž účet Windows, který aplikaci poprvé spustil, a zvolte spuštění bez přihlášení uživatele. Při uložení zadejte heslo účtu.
4. Na kartě **Aktivační události** přidejte **Při spuštění systému**.
5. Na kartě **Akce** nastavte:
   - Program: `C:\Program Files\PowerShell\7\pwsh.exe`
   - Argumenty: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Apps\tta-mcp-server\Run-Local.ps1"`
   - Spustit v: `C:\Apps\tta-mcp-server`
6. Uložte úlohu, spusťte ji ručně tlačítkem **Spustit** a ověřte `/health/ready`.

Upravte cesty podle umístění PowerShellu 7 a projektu. Při každém dalším buildu zůstává poslední vydání v `C:\Temp\TTAMCP-Build`; úloha spustí poslední dokončený build.

## Síť, TLS a bezpečné uložení

- Windows spuštění naslouchá jen na `127.0.0.1:8380`. Port 8380 neotvírejte ve Windows Firewallu do sítě. Tento postup je určen pro lokální správu na serveru nebo přes RDP.
- Vzdálený MCP klient vyžaduje samostatně nakonfigurovanou HTTPS reverzní proxy a veřejný origin. Samotné spuštění `Run-Local.ps1` vzdálený přístup nepovolí.
- Pro interní TLS certifikát TTA nainstalujte kořenovou CA do úložiště **Local Computer → Trusted Root Certification Authorities**. Node.js spouštěný přes `Run-Local.ps1` používá důvěryhodné CA z Windows. Certifikát instalujte jen z ověřeného zdroje.
- Databáze je v `%LOCALAPPDATA%\TTA MCP Server\tta-mcp.sqlite`. Vault klíč je v témže adresáři chráněn Windows DPAPI pro aktuální účet. TTA hesla a `SYSTEM_SESSION_ID` se šifrují AES-256-GCM; heslo správce se ukládá jako Argon2id hash.
- Úloha Plánovače musí běžet pod stejným Windows účtem jako první spuštění. Nepřesouvejte DPAPI klíč na jiný účet a nezálohujte samotnou databázi bez odpovídajícího klíče. Při záloze serveru zastavte aplikaci a chraňte celý adresář zálohy šifrováním.

## Spuštění MCP klienta přes stdio

Pro klienta běžícího pod stejným Windows účtem spusťte:

```powershell
.\Run-Local.ps1 -Stdio
```

Příklady konfigurace jsou v [MCP_CLIENT_SETUP.md](MCP_CLIENT_SETUP.md). DPAPI klíč je dostupný pouze pod účtem, který jej vytvořil.
