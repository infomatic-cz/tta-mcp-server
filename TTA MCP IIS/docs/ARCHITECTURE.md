# Architektura

Verze 0.3.5 zachovává REST klienta a podle [Swaggeru konkrétní TTA instance](https://winserver-tta26.im.cz/TotalAgility/swagger/docs/v1) dynamicky objevuje její operace. IIS nasazení provozuje Node.js aplikaci přes HttpPlatformHandler pod existujícím HTTPS webem.

```text
MCP Streamable HTTP / stdio
          │
          ├─ MCP token → připojovací scope
          ├─ pojmenované job/activity GET nástroje
          ├─ dynamický seznam operací z TTA REST Swaggeru
          ├─ tta_api_read → pouze GET
          └─ tta_api_write → POST/PUT/PATCH/DELETE + operationId potvrzení
          └─ audit bez vstupních tajemství
                    │
IIS HTTPS :443 ──> HttpPlatformHandler ──> Fastify :dynamický loopback port
                                                    │
React UI ──────────────────────────────────────────┘
                    │
                    ├─ SQLite profiles, sessions, tokens, audit
                    ├─ Argon2id admin password hashes
                    └─ AES-256-GCM TTA credential vault
                              │
                              └─ TTA REST API /services/sdk/v1
                                    ├─ User session login / SSO
                                    ├─ session cache in-memory
                                    └─ operace deklarované REST Swaggerem
```

## Autentizace a relace

- Interní uživatel/heslo: `POST /users/sessions` s modelem `BasicAuthLogOn` (`UserName`, `Password`, `UnconditionalLogOn: false`).
- SSO: `POST /users/sessions/single-sign-on`; systémová session se předává v `Authorization`, tělo obsahuje `UserId`.
- Relace se ověřuje `POST /users/sessions/{sessionId}/validate`; odpověď se kontroluje přes `IsValid`.
- TTA session ID se posílá v hlavičce `Authorization` pro další REST volání, ukládá se jen v paměti a při změně profilu se zahodí.
- TTA vynucuje vlastní oprávnění pro joby a activity query.

## REST síťová vrstva

Výchozí API cesta je `/services/sdk/v1`; kontext například `/TotalAgility` patří do základní URL. Operace se načtou z `{baseUrl}/swagger/docs/v1`; spec host se nepoužívá, požadavky vždy míří na nakonfigurovaný TTA host a prefix. Metoda, cesta a parametry musí odpovídat tomuto Swaggeru. GET volá `tta_api_read`, ostatní deklarované metody `tta_api_write` po zopakování `operationId` v potvrzovacím poli. Obecná HTTP proxy ani uživatelsky zadaná URL nejsou dostupné. HTTP přesměrování se odmítá, každý požadavek má timeout profilu, velikost JSON/uploadu/odpovědi je omezena na 2 MB.

Starší profily s výchozí cestou `/Services/Sdk` se při upgradu převedou na `/services/sdk/v1`; jiné ručně nastavené cesty se zachovají.

## Datové hranice a limity

SQLite DB zůstává mimo zdrojový repozitář. TTA credentials jsou šifrované AES-256-GCM; session ID se do SQLite nezapisuje. Výstupy TTA redigují citlivá pole a známé citlivé job variable hodnoty. MCP tokeny jsou omezené na připojení, ale nemají scope na jednotlivé nástroje.

IIS ukládá databázi a DPAPI LocalMachine šifrovaný vault klíč pod `%ProgramData%\TTA MCP IIS`. Aplikační pool používá vlastní identitu a ACL omezuje přístup k datům, logům a vydané aplikaci.

Kompletní plocha REST Swaggeru je dostupná přes obecné discovery/call nástroje. SDK metody, které konkrétní REST Swagger nevystavuje, OAuth client credentials, Windows auth, plné RBAC, více konzolových uživatelů, PostgreSQL, Docker a MCP Resources/Prompts nejsou tímto pokryté.
