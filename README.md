# TTA MCP Server

Samostatný MCP server pro správu připojení Tungsten TotalAgility a přístupů MCP klientů. Aplikace nabízí React administrační rozhraní, Fastify API, MCP přes Streamable HTTP a `stdio`, audit a SQLite úložiště.

**Verze 0.2.0 – autentizace TTA SDK JSON a read-only provozní nástroje.** Podporuje interní uživatelské jméno/heslo přes `UserService.GetSessionWithPassword`, alternativní `SYSTEM_SESSION_ID` přes `GetSingleSignOnSession`, ověření session a čtení procesních definic, jobů a aktivit. Zápisové operace, dokumenty, uživatelé, Designer, PostgreSQL, Docker a plné RBAC zůstávají mimo tento release; viz [aktuální rozsah](docs/TTA_CAPABILITIES.md).

## Rychlý start ve Windows

Požadavky: Windows 10/11, PowerShell 7 a Node.js 22 nebo 24 LTS. Závislosti a výstup buildu se instalují mimo OneDrive do `C:\Temp\TTAMCP-Build`.

```powershell
cd 'C:\Users\pavel\OneDrive\Development\Web\TTA\TTA MCP Server'
Set-ExecutionPolicy -Scope Process Bypass
.\Run-Local.ps1
```

Skript připraví build, vygeneruje lokální šifrovací klíč uložený pod Windows DPAPI a spustí aplikaci na `http://127.0.0.1:8380`. Otevřete adresu v prohlížeči. Při prvním spuštění stránka zobrazí jednorázový instalační kód dostupný jen přes lokální přístup. Vytvořte účet správce s heslem o délce alespoň 12 znaků. Neexistují výchozí uživatelské jméno ani heslo.

Další spuštění otevře přihlášení. Aplikaci ukončíte `Ctrl+C` v PowerShellu. Databáze a DPAPI chráněný klíč zůstávají v `%LOCALAPPDATA%\TTA MCP Server`, nikoliv v repozitáři.

## Build a spuštění

```powershell
.\New-Build.ps1
.\Run-Local.ps1
```

Výstupy jsou v `C:\Temp\TTAMCP-Build\release`; zdrojové soubory v OneDrive se při buildu nemění kromě případného vytvoření `package-lock.json` při úplně prvním buildu. Vývojový frontend lze spustit v druhém okně přes `npm run dev:web` v dočasné zrcadlené složce buildu.

## Připojení TotalAgility

V konzoli otevřete **TTA připojení → Přidat připojení**. Zadejte název, základní HTTPS adresu a typ instalace. Cesta SDK JSON má výchozí hodnotu `/Services/Sdk`; pokud vaše TTA instance používá jinou cestu, upravte ji. On-premise URL s kontextem může vypadat například `https://tta.example/TotalAgility` a cesta SDK se k ní připojí.

Pro běžné interní přihlášení vyberte **Interní uživatel a heslo**, zadejte TTA uživatelské jméno a heslo a ponechte logon protocol `7 · Internet`. Uložené tajemství se šifruje AES-256-GCM. `SYSTEM_SESSION_ID` je volitelný režim SSO; není nutný, pokud TTA SDK přijímá interní username/password. Tajemství se nezobrazí znovu, neloguje se a session ID se drží jen v paměti procesu.

Tlačítko **Test SDK** zavolá TTA `UserService`, získá session a ověří ji metodou `ValidateSession`. Stav **API ověřeno** potvrzuje dostupnost nakonfigurovaného SDK JSON endpointu a přihlášení; oprávnění jednotlivých nástrojů se stále řídí účtem v TTA. HTTP 401/403 značí odmítnutou autentizaci nebo oprávnění; 404 obvykle znamená chybnou cestu SDK.

Vytvořte MCP token v **MCP klienti**, přiřaďte mu konkrétní TTA prostředí a expiraci. Token se zobrazí pouze jednou. Do konfigurace vzdáleného MCP klienta vložte URL `https://<vaše-doména>/tta-mcp` a token jako Bearer credential. Dostupné nástroje: `tta_connections_list`, `tta_connection_test`, `tta_processes_list`, `tta_process_details`, `tta_process_help`, `tta_process_states`, `tta_job_state`, `tta_job_history`, `tta_job_events` a `tta_job_activities`. Katalog a nepodporované funkce jsou v [TTA capabilities](docs/TTA_CAPABILITIES.md).

## Nasazení na Linux VM

Použijte skript z Windows stanice s OpenSSH klientem:

```powershell
.\Deploy-Server.ps1 -Server 'tta-mcp.example.cz' -User 'pavel' -PublicOrigin 'https://tta-mcp.example.cz'
```

VM potřebuje podporovanou LTS verzi Ubuntu/Debian se systemd a `systemd-creds` 250+, Node.js 22/24 LTS dostupný jako `/usr/bin/node`, `npm`, `openssl`, `tar`, `runuser`, `useradd`, `sudo` a SSH přístup. Pro nasazení musí VM mít odchozí HTTPS/DNS přístup k npm registry a k TTA endpointům. Nasazovací účet potřebuje SSH klíč a neinteraktivní `sudo -n` oprávnění (nebo přihlášení jako root). Skript vytvoří systémového uživatele a systemd službu. Při prvním nasazení se klíč vygeneruje na VM a uloží šifrovaně pomocí `systemd-creds`; odemčená kopie je pouze v chráněném runtime credential úložišti služby. Databáze je v `/var/lib/tta-mcp-server`.

Aplikace naslouchá pouze na `127.0.0.1:8380`. Pro bezpečný vzdálený provoz nastavte reverzní proxy s platným TLS certifikátem, povolte pouze HTTPS a přepněte `TTA_COOKIE_SECURE=true` v `/etc/tta-mcp-server/server.env`. Ukázková konfigurace Nginx je v [Instalaci Linuxu](docs/INSTALLATION_LINUX.md). Při prvním nastavení se připojte přes SSH tunel:

```powershell
ssh -L 8380:127.0.0.1:8380 pavel@tta-mcp.example.cz
```

Otevřete `http://127.0.0.1:8380`, dokončete první vytvoření správce a následně zapněte `TTA_COOKIE_SECURE=true` a restartujte službu. Nepovolujte přímý přístup na port 8380 z internetu.

## MCP přes stdio

Lokální klient může spustit server jako podproces:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\pavel\OneDrive\Development\Web\TTA\TTA MCP Server\Run-Local.ps1' -Stdio
```

Pro `stdio` se nepoužívá vzdálený API token; oprávnění odpovídá lokálnímu uživatelskému účtu Windows. V klientovi nastavte spuštění příkazu jako MCP server. Příklady Codex/Claude Desktop jsou v [MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md).

## Bezpečnost a omezení

- Hesla správce se ukládají jako Argon2id hash. Relace i MCP tokeny jsou náhodné a v databázi uložené pouze jako SHA-256 hash.
- Tajemství připojení jsou šifrovaná AES-256-GCM. Klíč není v SQLite ani zdrojovém kódu: Windows používá DPAPI; Linux VM šifrované systemd credentials.
- Administrační cookie je HttpOnly, SameSite=Strict a na vzdálené instalaci Secure. Mutující administrační API kontroluje Origin.
- Výchozí síťový bind je loopback; TTA adresa vyžaduje HTTPS, pokud administrátor výslovně nepovolí HTTP.
- MCP token lze omezit na vybraná prostředí, expirovat a okamžitě revokovat.
- TTA operace v 0.2.0 jsou pouze read-only a volají pojmenované SDK metody přes JSON POST. Test spojení ověřuje `UserService`; neprokazuje automaticky dostupnost každé read-only metody v konkrétním tenantovi.
- `SYSTEM_SESSION_ID` a TTA heslo se šifrují stejným vault klíčem. Zálohujte databázi a chráněný vault klíč společně.

Podrobnosti: [Architektura](docs/ARCHITECTURE.md), [Konfigurace](docs/CONFIGURATION.md), [Bezpečnost](docs/SECURITY.md), [Windows](docs/INSTALLATION_WINDOWS.md), [Linux](docs/INSTALLATION_LINUX.md), [kompatibilita TTA](docs/TTA_API_COMPATIBILITY.md).
