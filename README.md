# TTA MCP Server

Samostatný MCP server pro správu připojení Tungsten TotalAgility a přístupů MCP klientů. Aplikace nabízí React administrační rozhraní, Fastify API, MCP přes Streamable HTTP a `stdio`, audit a SQLite úložiště.

**Verze 0.2.6.** Konektor používá REST API `/services/sdk/v1`, jeho odpověď validace `IsValid` a autorizační hlavičku TTA session ID. Podporuje interní jméno/heslo, alternativní `SYSTEM_SESSION_ID`, read-only nástroje pro joby a aktivity. Zápisové operace, dokumenty, uživatelé, Designer, PostgreSQL, Docker a plné RBAC zůstávají mimo tento release; viz [aktuální rozsah](docs/TTA_CAPABILITIES.md).

## Rychlý start ve Windows

Požadavky: Windows 10/11, PowerShell 7 a Node.js 22.15+ nebo 24 LTS. Zdrojové soubory mohou být ve složce OneDrive; závislosti a výstup buildu se instalují mimo OneDrive do `C:\Temp\TTAMCP-Build`.

V PowerShellu otevřete složku projektu v OneDrive a spusťte:

```powershell
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

Výstupy jsou v časově označené složce `C:\Temp\TTAMCP-Build\release-<version>-<build-id>` a build archiv je přímo v `C:\Temp\TTAMCP-Build`. Lokální skript spouští poslední dokončenou verzi; nové sestavení během běhu starší verze ji nepřepisuje. Zdrojové soubory v OneDrive se při buildu nemění kromě případného vytvoření `package-lock.json` při úplně prvním buildu.

## Připojení TotalAgility

V konzoli otevřete **TTA připojení → Přidat připojení**. Zadejte název, základní HTTPS adresu a typ instalace. Výchozí cesta REST API je `/services/sdk/v1`. Pro Swagger URL `https://tta.example/TotalAgility/swagger/ui/index#/Job` zadejte jako základ `https://tta.example/TotalAgility`; aplikace umí zpracovat i vložený odkaz Swagger UI. Kontext `/TotalAgility` musí být součástí základní adresy.

Pro běžné interní přihlášení vyberte **Interní uživatel a heslo** a zadejte TTA uživatelské jméno a heslo. REST login odešle `UserName`, `Password` a `UnconditionalLogOn: false`. V režimu `SYSTEM_SESSION_ID` zadejte do pole uživatele jméno TTA účtu, pro který má TTA vytvořit relaci; toto jméno se posílá jako `UserId`. Použijte uživatelský tvar přesně tak, jak ho zná TTA, včetně domény, například `im\vraj`. Do pole `SYSTEM_SESSION_ID` patří systémový GUID z nastavení TotalAgility **System → System settings → Logon and authentication → User sessions**. ID se předává v hlavičce `Authorization`, uživatelské jméno v těle požadavku. Uložené tajemství se šifruje AES-256-GCM. Session ID se drží jen v paměti procesu.

Tlačítko **Test REST API** zavolá `POST /users/sessions`, přečte `SessionId` a `LogOnStateType`, poté ověří relaci endpointem `/users/sessions/{sessionId}/validate` a polem `IsValid`. Stav **API ověřeno** potvrzuje autentizaci REST API; oprávnění k jednotlivým jobům a query stále řídí účet v TTA. HTTP 401/403 obvykle značí zamítnuté přihlašovací údaje nebo oprávnění; 404 znamená chybnou základní URL či cestu API.

Chyba „TTA REST API není dosažitelné nebo selhalo ověření TLS/DNS“ nastane ještě před přihlášením a nesouvisí s uživatelským jménem ani session ID. Na Windows `Run-Local.ps1` spouští Node.js s důvěrou k systémovým certifikátům. Interní kořenovou CA nainstalujte do úložiště **Trusted Root Certification Authorities** uživatele nebo počítače, pod kterým server běží; ověřování TLS zůstává zapnuté. Na Linux VM nastavte `NODE_EXTRA_CA_CERTS` na PEM soubor CA v `/etc/tta-mcp-server/server.env`.

Pokud interní CA nelze nainstalovat, otevřete **Upravit připojení** a zapněte **Důvěřovat certifikátu TTA**. Volba vypne ověření řetězce i názvu certifikátu pouze pro dané TTA připojení; TLS šifrování zůstane zapnuté, ale protistrana nebude ověřená. Používejte ji jen v důvěryhodné síti. Preferované řešení je instalace interní kořenové CA. Test připojení rozlišuje chyby TLS, DNS a odmítnutého síťového spojení; bezpečný výsledek se zapisuje i do serverové konzole.

Vytvořte MCP token v **MCP klienti**, přiřaďte mu konkrétní TTA prostředí a expiraci. Token se zobrazí pouze jednou. Do konfigurace vzdáleného MCP klienta vložte URL `https://<vaše-doména>/tta-mcp` a token jako Bearer credential. Nástroje zahrnují přehled jobů přes pojmenované TTA query, detail/stav/historii/proměnné jobů a aktivity/query/workqueue. Viz [TTA capabilities](docs/TTA_CAPABILITIES.md).

## Nasazení na Linux VM

Použijte skript z Windows stanice s OpenSSH klientem:

```powershell
.\Deploy-Server.ps1 -Server 'tta-mcp.example.cz' -User 'pavel' -PublicOrigin 'https://tta-mcp.example.cz'
```

VM potřebuje podporovanou LTS verzi Ubuntu/Debian se systemd a `systemd-creds` 250+, Node.js 22.15+/24 LTS dostupný jako `/usr/bin/node`, `npm`, `openssl`, `tar`, `runuser`, `useradd`, `sudo` a SSH přístup. Pro nasazení musí VM mít odchozí HTTPS/DNS přístup k npm registry a k TTA endpointům. Nasazovací účet potřebuje SSH klíč a neinteraktivní `sudo -n` oprávnění (nebo přihlášení jako root). Skript vytvoří systémového uživatele a systemd službu. Při prvním nasazení se klíč vygeneruje na VM a uloží šifrovaně pomocí `systemd-creds`; odemčená kopie je pouze v chráněném runtime credential úložišti služby. Databáze je v `/var/lib/tta-mcp-server`.

Aplikace naslouchá pouze na `127.0.0.1:8380`. Pro bezpečný vzdálený provoz nastavte reverzní proxy s platným TLS certifikátem, povolte pouze HTTPS a přepněte `TTA_COOKIE_SECURE=true` v `/etc/tta-mcp-server/server.env`. Ukázková konfigurace Nginx je v [Instalaci Linuxu](docs/INSTALLATION_LINUX.md). Při prvním nastavení se připojte přes SSH tunel:

```powershell
ssh -L 8380:127.0.0.1:8380 pavel@tta-mcp.example.cz
```

Otevřete `http://127.0.0.1:8380`, dokončete první vytvoření správce a následně zapněte `TTA_COOKIE_SECURE=true` a restartujte službu. Nepovolujte přímý přístup na port 8380 z internetu.

## MCP přes stdio

Lokální klient může spustit server jako podproces:

```powershell
.\Run-Local.ps1 -Stdio
```

Pro `stdio` se nepoužívá vzdálený API token; oprávnění odpovídá lokálnímu uživatelskému účtu Windows. V klientovi nastavte spuštění příkazu jako MCP server. Příklady Codex/Claude Desktop jsou v [MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md).

## Bezpečnost a omezení

- Hesla správce se ukládají jako Argon2id hash. Relace i MCP tokeny jsou náhodné a v databázi uložené pouze jako SHA-256 hash.
- Tajemství připojení jsou šifrovaná AES-256-GCM. Klíč není v SQLite ani zdrojovém kódu: Windows používá DPAPI; Linux VM šifrované systemd credentials.
- Administrační cookie je HttpOnly, SameSite=Strict a na vzdálené instalaci Secure. Mutující administrační API kontroluje Origin.
- Výchozí síťový bind je loopback; TTA adresa vyžaduje HTTPS, pokud administrátor výslovně nepovolí HTTP.
- MCP token lze omezit na vybraná prostředí, expirovat a okamžitě revokovat.
- TTA operace v 0.2.6 jsou pouze read-only a volají konkrétní REST endpointy z allowlistu. Test spojení ověřuje REST login a `IsValid`; neprokazuje automaticky oprávnění pro každé TTA query.
- `SYSTEM_SESSION_ID` a TTA heslo se šifrují stejným vault klíčem. Zálohujte databázi a chráněný vault klíč společně.

Podrobnosti: [Architektura](docs/ARCHITECTURE.md), [Konfigurace](docs/CONFIGURATION.md), [Bezpečnost](docs/SECURITY.md), [Windows](docs/INSTALLATION_WINDOWS.md), [Linux](docs/INSTALLATION_LINUX.md), [kompatibilita TTA](docs/TTA_API_COMPATIBILITY.md).
