# Changelog

Změny jsou řazeny od nejnovější verze. Projekt používá Semantic Versioning.

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
