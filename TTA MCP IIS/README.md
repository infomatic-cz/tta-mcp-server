# TTA MCP Server

Samostatný MCP server pro správu připojení Tungsten TotalAgility a přístupů MCP klientů. Aplikace nabízí React administrační rozhraní, Fastify API, MCP přes Streamable HTTP a `stdio`, audit a SQLite úložiště.

**Verze 0.3.1.** IIS varianta zachovává stejné TTA a MCP funkce a přidává hostování jako IIS aplikace. Konektor používá REST API `/services/sdk/v1`, jeho odpověď validace `IsValid` a autorizační hlavičku TTA session ID. Podporuje interní jméno/heslo, alternativní `SYSTEM_SESSION_ID`, read-only nástroje pro joby a aktivity. Zápisové operace, dokumenty, uživatelé, Designer, PostgreSQL, Docker a plné RBAC zůstávají mimo tento release; viz [aktuální rozsah](docs/TTA_CAPABILITIES.md).

## Nasazení na IIS

IIS obsluhuje HTTPS na existujícím portu 443. Modul HttpPlatformHandler spouští a spravuje Node.js proces aplikace; Nginx, IIS ARR ani samostatný veřejný port aplikace nejsou potřeba. Připojení k TTA stále vyžaduje funkční DNS/síť a důvěryhodný TLS certifikát ve Windows.

Na pracovní stanici vytvořte balíček příkazem `New-Build.ps1`; ZIP vznikne v `C:\Temp\TTAMCP-Build\IIS`. Na serveru ho rozbalte a postupujte podle [instalačního návodu pro IIS](docs/INSTALLATION_IIS.md). Příklad nasazení do aplikace `/tta-mcp` existujícího webu:

```powershell
.\Deploy-IIS.ps1 -SiteName 'Default Web Site' -ApplicationPath '/tta-mcp' -PublicOrigin 'https://tta-mcp.example.cz'
```

Přístup bude `https://tta-mcp.example.cz/tta-mcp/`; administrační konzole zobrazí přesnou MCP adresu.

## Rychlý start ve Windows

Na vývojové stanici vytvořte hotový Windows balíček příkazem `New-Build.ps1`; soubor `tta-mcp-server-iis-<verze>-windows-x64.zip` vznikne v `C:\Temp\TTAMCP-Build\IIS`. Na cílovém Windows Serveru stačí stejná hlavní verze Node.js a Visual C++ Redistributable x64. Git, Python, Visual Studio Build Tools ani npm instalace tam nejsou potřeba.

Následující příkazy spouštějí zdrojový projekt na vývojovém počítači. Na cílovém Windows Serveru připojte rozbalený ZIP jako IIS aplikaci podle instalační příručky.

V PowerShellu otevřete složku projektu v OneDrive a spusťte:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Run-Local.ps1
```

Skript připraví build, vygeneruje lokální šifrovací klíč uložený pod Windows DPAPI a spustí aplikaci na `http://127.0.0.1:8380`. Otevřete adresu v prohlížeči. Při prvním spuštění stránka zobrazí jednorázový instalační kód dostupný jen přes lokální přístup. Vytvořte účet správce s heslem o délce alespoň 12 znaků. Neexistují výchozí uživatelské jméno ani heslo.

Další spuštění otevře přihlášení. Aplikaci ukončíte `Ctrl+C` v PowerShellu. Databáze a DPAPI chráněný klíč zůstávají v `%LOCALAPPDATA%\TTA MCP IIS`, nikoliv v repozitáři.

## Build a spuštění

```powershell
.\New-Build.ps1
.\Run-Local.ps1
```

Výstupy jsou v časově označené složce `C:\Temp\TTAMCP-Build\IIS\release-<version>-<build-id>` a ZIP v `C:\Temp\TTAMCP-Build\IIS`. Lokální skript spouští poslední dokončenou verzi; build a závislosti zůstávají mimo OneDrive.

## Připojení TotalAgility

V konzoli otevřete **TTA připojení → Přidat připojení**. Zadejte název, základní HTTPS adresu a typ instalace. Výchozí cesta REST API je `/services/sdk/v1`. Pro Swagger URL `https://tta.example/TotalAgility/swagger/ui/index#/Job` zadejte jako základ `https://tta.example/TotalAgility`; aplikace umí zpracovat i vložený odkaz Swagger UI. Kontext `/TotalAgility` musí být součástí základní adresy.

Pro běžné interní přihlášení vyberte **Interní uživatel a heslo** a zadejte TTA uživatelské jméno a heslo. REST login odešle `UserName`, `Password` a `UnconditionalLogOn: false`. V režimu `SYSTEM_SESSION_ID` zadejte do pole uživatele jméno TTA účtu, pro který má TTA vytvořit relaci; toto jméno se posílá jako `UserId`. Použijte uživatelský tvar přesně tak, jak ho zná TTA, včetně domény, například `im\vraj`. Do pole `SYSTEM_SESSION_ID` patří systémový GUID z nastavení TotalAgility **System → System settings → Logon and authentication → User sessions**. ID se předává v hlavičce `Authorization`, uživatelské jméno v těle požadavku. Uložené tajemství se šifruje AES-256-GCM. Session ID se drží jen v paměti procesu.

Tlačítko **Test REST API** zavolá `POST /users/sessions`, přečte `SessionId` a `LogOnStateType`, poté ověří relaci endpointem `/users/sessions/{sessionId}/validate` a polem `IsValid`. Stav **API ověřeno** potvrzuje autentizaci REST API; oprávnění k jednotlivým jobům a query stále řídí účet v TTA. HTTP 401/403 obvykle značí zamítnuté přihlašovací údaje nebo oprávnění; 404 znamená chybnou základní URL či cestu API.

Chyba „TTA REST API není dosažitelné nebo selhalo ověření TLS/DNS“ nastane ještě před přihlášením a nesouvisí s uživatelským jménem ani session ID. IIS spouští Node.js s důvěrou k systémovým certifikátům Windows. Interní kořenovou CA nainstalujte do úložiště **Trusted Root Certification Authorities** místního počítače; ověřování TLS zůstává zapnuté.

Pokud interní CA nelze nainstalovat, otevřete **Upravit připojení** a zapněte **Důvěřovat certifikátu TTA**. Volba vypne ověření řetězce i názvu certifikátu pouze pro dané TTA připojení; TLS šifrování zůstane zapnuté, ale protistrana nebude ověřená. Používejte ji jen v důvěryhodné síti. Preferované řešení je instalace interní kořenové CA. Test připojení rozlišuje chyby TLS, DNS a odmítnutého síťového spojení; bezpečný výsledek se zapisuje i do serverové konzole.

Vytvořte MCP token v **MCP klienti**, přiřaďte mu konkrétní TTA prostředí a expiraci. Token se zobrazí pouze jednou. Do konfigurace klienta vložte přesnou MCP adresu zobrazenou v konzoli a token jako Bearer credential. Pro IIS aplikaci `/tta-mcp` bude adresa typicky `https://<vaše-doména>/tta-mcp/tta-mcp`. Nástroje zahrnují přehled jobů přes pojmenované TTA query, detail/stav/historii/proměnné jobů a aktivity/query/workqueue. Viz [TTA capabilities](docs/TTA_CAPABILITIES.md).

## MCP přes stdio

Lokální klient může spustit server jako podproces:

```powershell
.\Run-Local.ps1 -Stdio
```

Pro `stdio` se nepoužívá vzdálený API token; oprávnění odpovídá lokálnímu uživatelskému účtu Windows. V klientovi nastavte spuštění příkazu jako MCP server. Příklady Codex/Claude Desktop jsou v [MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md).

## Bezpečnost a omezení

- Hesla správce se ukládají jako Argon2id hash. Relace i MCP tokeny jsou náhodné a v databázi uložené pouze jako SHA-256 hash.
- Tajemství připojení jsou šifrovaná AES-256-GCM. Klíč není v SQLite ani zdrojovém kódu: IIS používá DPAPI LocalMachine a běžné lokální spuštění Windows DPAPI aktuálního uživatele.
- Administrační cookie je HttpOnly, SameSite=Strict a na vzdálené instalaci Secure. Mutující administrační API kontroluje Origin.
- Výchozí síťový bind je loopback; TTA adresa vyžaduje HTTPS, pokud administrátor výslovně nepovolí HTTP.
- MCP token lze omezit na vybraná prostředí, expirovat a okamžitě revokovat.
- TTA operace v 0.3.1 jsou pouze read-only a volají konkrétní REST endpointy z allowlistu. Test spojení ověřuje REST login a `IsValid`; neprokazuje automaticky oprávnění pro každé TTA query.
- `SYSTEM_SESSION_ID` a TTA heslo se šifrují stejným vault klíčem. Zálohujte databázi a chráněný vault klíč společně.

Podrobnosti: [Architektura](docs/ARCHITECTURE.md), [Konfigurace](docs/CONFIGURATION.md), [Bezpečnost](docs/SECURITY.md), [IIS](docs/INSTALLATION_IIS.md), [kompatibilita TTA](docs/TTA_API_COMPATIBILITY.md).
