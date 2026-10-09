# Changelog

Změny jsou řazeny od nejnovější verze. Projekt používá Semantic Versioning.

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
