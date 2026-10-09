# Changelog

Změny jsou řazeny od nejnovější verze. Projekt používá Semantic Versioning.

## [0.2.4] – 2026-10-09

### Přidáno
- Nastavení „Důvěřovat certifikátu TTA“ pro jednotlivé připojení; ve výchozím stavu zůstává ověřování TLS zapnuté.
- Diagnostika testu rozlišuje chyby TLS certifikátu, DNS a odmítnuté síťové spojení.
- SQLite migrace přidává příznak důvěry certifikátu bez změny stávajících profilů.

### Bezpečnost
- Vysvětleno riziko vypnutí kontroly TLS identity; doporučenou cestou zůstává instalace interní CA.
- Aktualizováno číslo verze aplikace a MCP serveru na 0.2.4.

## [0.2.3] – 2026-10-09

### Změněno
- Návody už neobsahují osobní absolutní cesty; umístění projektu popisují obecně jako složku v OneDrive.
- Původní zadání bylo přesunuto z kořene repozitáře do lokální složky `Pracovní/`, která je ignorována Gitem.
- Lokální spouštěč používá důvěryhodné CA z úložiště Windows; ověřování TLS se nevypíná. Nápověda SSO rozlišuje uživatelské `UserId` od systémového ID.
- Aktualizováno číslo verze aplikace a MCP serveru na 0.2.3.

## [0.2.2] – 2026-10-09

### Opraveno
- Odkaz na repozitář v administrační konzoli nyní míří na `https://github.com/infomatic-cz/tta-mcp-server`.
- Build i deploy skript používají verzi archivu přímo z `package.json`, takže při dalších vydáních nezůstane deploy připnutý na staré číslo verze.
- Aktualizováno číslo verze aplikace a MCP serveru na 0.2.2.

## [0.2.1] – 2026-10-09

### Opraveno
- Připojení přepnuto z neodpovídajícího WCF SDK JSON endpointu na REST API `/services/sdk/v1` popsané Swaggerem konkrétní TTA instance.
- Password login nyní posílá `BasicAuthLogOn`; validace relace kontroluje skutečné pole `IsValid` z `UserSessionValidation` místo neexistujícího `SessionId`.
- SSO požadavek nyní posílá `SYSTEM_SESSION_ID` v hlavičce `Authorization` a `UserId` v těle, jak požaduje Swagger.
- Read-only job a activity nástroje nyní používají doložené REST GET routy; zavádějící procesní SDK nástroje byly odstraněny.
- Stávající profily s výchozí `/Services/Sdk` cestou se migrují na `/services/sdk/v1`; ručně nastavené cesty zůstávají zachované.
- Přijímá se také vložená URL Swagger UI a normalizuje se na kořen TTA aplikace.

### Dokumentace a build
- Kompatibilita, architektura, nastavení, MCP katalog a návod připojení aktualizovány podle načtené OpenAPI v1 specifikace.
- Build a deploy PowerShell skripty vytvářejí archiv `tta-mcp-server-0.2.1.tgz` mimo OneDrive.
- Lokální buildy dostávají jedinečné časově označené release složky, aby přestavba nekolidovala se zamčenými soubory běžícího serveru.
- Odpovědi jobů redigují i hodnoty proměnných s názvy připomínajícími heslo, token, secret či credential.

### Omezení
- Swagger/OpenAPI bylo načteno z poskytnuté instance, ale přihlášení a oprávnění nebyla runtime ověřena bez credentials.
- Zápisové operace z REST API se do MCP nepřidávají; zůstávají nepodporované.

## [0.2.0] – 2026-10-09

### Přidáno
- TTA SDK JSON klient volá `UserService.GetSessionWithPassword` nebo `GetSingleSignOnSession` podle zvoleného způsobu autentizace a ověřuje relaci metodou `ValidateSession`.
- Konfigurace připojení obsahuje SDK cestu, logon protocol a režimy interní heslo / `SYSTEM_SESSION_ID`; TTA tajemství zůstávají šifrovaná AES-256-GCM.
- Session ID se drží pouze v paměťové cache, před použitím se validuje a při změně nebo odstranění profilu se zahodí.
- Read-only MCP nástroje pro procesní definice, job stav/historii/události a aktivity; pouze pevný SDK allowlist, kontrola connection scope a audit volání.
- Výstupy TTA jsou omezené na 2 MB a známá citlivá pole se redigují.

### Dokumentace
- Aktualizované README, kompatibilita SDK, capability registry, architektura, bezpečnost a nastavení MCP klienta.
- Build/deploy artefakty přejmenovány na verzi 0.2.0; build proběhl v `C:\Temp\TTAMCP-Build`.

### Omezení
- TTA tenant ani Linux VM nebyly v tomto prostředí dostupné pro běhové ověření.
- Zápisové operace, dokumenty, uživatelé/skupiny, Designer, OAuth, víceuživatelské RBAC, PostgreSQL, Docker, MCP Resources/Prompts a plný audit/monitoring nejsou dokončené.
- SDK JSON default `/Services/Sdk` je konfigurovatelný; cloudový tenant může vyžadovat jinou cestu.

## [0.1.2] – 2026-10-09

### Změněno
- Přesunuty build, lokální spouštěcí a nasazovací PowerShell skripty do kořene projektu; opraveny jejich cesty po přesunu.
- Výchozí port lokálního i VM provozu změněn z `8080` na `8380`, včetně konfigurace, vývojového proxy, systemd služby a návodů.

### Ověření
- Build z kořenového `New-Build.ps1` vytvořil release i Linux archiv mimo OneDrive.
- `Run-Local.ps1` z kořene projektu spustil verzi 0.1.2 na výchozím portu 8380; health a readiness vrátily úspěch.
- Cílová Linux VM nebyla nasazena ani ověřena.

## [0.1.1] – 2026-10-09

### Změněno
- Lokální start vypíše adresu až před spuštěním serveru; stránku otevřete po jeho naběhnutí.
- Doplněny přesné požadavky nasazovacího uživatele a síťového přístupu VM.

### Ověření
- Čistý build skriptem `scripts/New-Build.ps1` dokončen.
- Ruční smoke: health/readiness, úvodní vytvoření správce, přihlášení, MCP `initialize`, `tools/list` a volání `tta_connections_list`.
- Skutečný TTA server ani cílová Linux VM zatím ověřeny nebyly.

## [0.1.0] – 2026-10-09

### Přidáno
- První spustitelný základ: TypeScript/Fastify backend, React administrační konzole a SQLite úložiště.
- Jednorázové první nastavení správce, Argon2id hesla, omezené sessions, kontrola Origin a auditní záznamy.
- Správa více TTA profilů, AES-256-GCM šifrování volitelných přihlašovacích údajů a bezpečný test HTTP dosažitelnosti.
- Streamable HTTP MCP endpoint s Bearer tokeny omezenými na vybraná prostředí; lokální MCP transport `stdio`.
- PowerShell skripty pro build mimo OneDrive, lokální spuštění a nasazení na Linux VM.
- Dokumentace prvního přihlášení, zabezpečení, provozu na VM a aktuálního rozsahu ověření TTA.

### Omezení
- Nejsou implementovány ani ověřeny operace procesů, úloh, aktivit, dokumentů, uživatelů nebo Designeru TTA.
- Test připojení ověřuje pouze HTTP dosažitelnost; nepoužívá uložené přihlašovací údaje.
- Vzdálená instalace vyžaduje externí TLS reverse proxy; aplikace sama neposkytuje veřejný TLS terminátor.
- Databáze první verze je SQLite; PostgreSQL a Docker deployment nejsou součástí této verze.
