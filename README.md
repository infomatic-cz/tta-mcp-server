# TTA MCP Server

První spustitelná verze víceuživatelského základu pro správu připojení Tungsten TotalAgility a přístupů MCP klientů. Aplikace nabízí React administrační rozhraní, Fastify API, MCP přes Streamable HTTP a `stdio`, audit a SQLite úložiště.

**Verze 0.1.1 – technický základ a bezpečné připojovací profily.** Tato verze zatím nečte ani nemění procesy, úlohy, dokumenty nebo návrhové objekty v TTA. TTA test ověřuje pouze HTTP dosažitelnost uložené adresy. Neoznačuje instalaci jako kompatibilní ani neověřuje autentizaci.

## Rychlý start ve Windows

Požadavky: Windows 10/11, PowerShell 7 a Node.js 22 nebo 24 LTS. Závislosti a výstup buildu se instalují mimo OneDrive do `C:\Temp\TTAMCP-Build`.

```powershell
cd 'C:\Users\pavel\OneDrive\Development\Web\TTA\TTA MCP Server'
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Run-Local.ps1
```

Skript připraví build, vygeneruje lokální šifrovací klíč uložený pod Windows DPAPI a spustí aplikaci na `http://127.0.0.1:8080`. Otevřete adresu v prohlížeči. Při prvním spuštění stránka zobrazí jednorázový instalační kód dostupný jen přes lokální přístup. Vytvořte účet správce s heslem o délce alespoň 12 znaků. Neexistují výchozí uživatelské jméno ani heslo.

Další spuštění otevře přihlášení. Aplikaci ukončíte `Ctrl+C` v PowerShellu. Databáze a DPAPI chráněný klíč zůstávají v `%LOCALAPPDATA%\TTA MCP Server`, nikoliv v repozitáři.

## Build a spuštění

```powershell
.\scripts\New-Build.ps1
.\scripts\Run-Local.ps1
```

Výstupy jsou v `C:\Temp\TTAMCP-Build\release`; zdrojové soubory v OneDrive se při buildu nemění kromě případného vytvoření `package-lock.json` při úplně prvním buildu. Vývojový frontend lze spustit v druhém okně přes `npm run dev:web` v dočasné zrcadlené složce buildu.

## Připojení TotalAgility

V konzoli otevřete **TTA připojení → Přidat připojení**. Zadejte název, HTTPS adresu a typ instalace. Volitelně lze uložit uživatelské jméno a heslo; server je zašifruje algoritmem AES-256-GCM a nikdy je znovu nevrací do GUI. Verzi lze doplnit ručně, jinak zůstane „Nezjištěna“.

Tlačítko **Test** provede pouze bezpečný HTTP GET na základní adresu. Neposílá uložené přihlašovací údaje a nesimuluje TTA API. Výsledek 401/403 znamená, že webový server odpovídá, ale vyžaduje nebo odmítá autentizaci. Přesměrování se nesledují.

Vytvořte MCP token v **MCP klienti**, přiřaďte mu konkrétní TTA prostředí a expiraci. Token se zobrazí pouze jednou. Do konfigurace vzdáleného MCP klienta vložte URL `https://<vaše-doména>/tta-mcp` a token jako Bearer credential. Server nabízí `tta_connections_list` a `tta_connection_test`; ostatní TTA procesní nástroje zůstávají nedostupné, dokud nebudou jejich metody ověřeny.

## Nasazení na Linux VM

Použijte skript z Windows stanice s OpenSSH klientem:

```powershell
.\scripts\Deploy-Server.ps1 -Server 'tta-mcp.example.cz' -User 'pavel' -PublicOrigin 'https://tta-mcp.example.cz'
```

VM potřebuje podporovanou LTS verzi Ubuntu/Debian se systemd a `systemd-creds` 250+, Node.js 22/24 LTS dostupný jako `/usr/bin/node`, `npm`, `openssl`, `tar`, `runuser`, `useradd`, `sudo` a SSH přístup. Pro nasazení musí VM mít odchozí HTTPS/DNS přístup k npm registry a k TTA endpointům. Nasazovací účet potřebuje SSH klíč a neinteraktivní `sudo -n` oprávnění (nebo přihlášení jako root). Skript vytvoří systémového uživatele a systemd službu. Při prvním nasazení se klíč vygeneruje na VM a uloží šifrovaně pomocí `systemd-creds`; odemčená kopie je pouze v chráněném runtime credential úložišti služby. Databáze je v `/var/lib/tta-mcp-server`.

Aplikace naslouchá pouze na `127.0.0.1:8080`. Pro bezpečný vzdálený provoz nastavte reverzní proxy s platným TLS certifikátem, povolte pouze HTTPS a přepněte `TTA_COOKIE_SECURE=true` v `/etc/tta-mcp-server/server.env`. Ukázková konfigurace Nginx je v [Instalaci Linuxu](docs/INSTALLATION_LINUX.md). Při prvním nastavení se připojte přes SSH tunel:

```powershell
ssh -L 8080:127.0.0.1:8080 pavel@tta-mcp.example.cz
```

Otevřete `http://127.0.0.1:8080`, dokončete první vytvoření správce a následně zapněte `TTA_COOKIE_SECURE=true` a restartujte službu. Nepovolujte přímý přístup na port 8080 z internetu.

## MCP přes stdio

Lokální klient může spustit server jako podproces:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\pavel\OneDrive\Development\Web\TTA\TTA MCP Server\scripts\Run-Local.ps1' -Stdio
```

Pro `stdio` se nepoužívá vzdálený API token; oprávnění odpovídá lokálnímu uživatelskému účtu Windows. V klientovi nastavte spuštění příkazu jako MCP server. Příklady Codex/Claude Desktop jsou v [MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md).

## Bezpečnost a omezení

- Hesla správce se ukládají jako Argon2id hash. Relace i MCP tokeny jsou náhodné a v databázi uložené pouze jako SHA-256 hash.
- Tajemství připojení jsou šifrovaná AES-256-GCM. Klíč není v SQLite ani zdrojovém kódu: Windows používá DPAPI; Linux VM šifrované systemd credentials.
- Administrační cookie je HttpOnly, SameSite=Strict a na vzdálené instalaci Secure. Mutující administrační API kontroluje Origin.
- Výchozí síťový bind je loopback; TTA adresa vyžaduje HTTPS, pokud administrátor výslovně nepovolí HTTP.
- MCP token lze omezit na vybraná prostředí, expirovat a okamžitě revokovat.
- Neprovádějí se TTA změny ani neověřené volání API. Kompatibilita jednotlivých verzí není v 0.1.1 ověřena.

Podrobnosti: [Architektura](docs/ARCHITECTURE.md), [Konfigurace](docs/CONFIGURATION.md), [Bezpečnost](docs/SECURITY.md), [Windows](docs/INSTALLATION_WINDOWS.md), [Linux](docs/INSTALLATION_LINUX.md), [kompatibilita TTA](docs/TTA_API_COMPATIBILITY.md).
