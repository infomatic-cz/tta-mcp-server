# Architektura

Verze 0.2.7 zachovává REST klienta představeného v 0.2.1 a volá TTA API podle [Swaggeru konkrétní TTA instance](https://winserver-tta26.im.cz/TotalAgility/swagger/docs/v1). Nejde o plnou implementaci původního pracovního zadání, které se uchovává mimo repozitář.

```text
MCP Streamable HTTP / stdio
          │
          ├─ MCP token → připojovací scope
          ├─ read-only nástroje s pevným REST allowlistem
          └─ audit bez vstupních tajemství
                    │
React UI ──> Fastify admin API
                    │
                    ├─ SQLite profiles, sessions, tokens, audit
                    ├─ Argon2id admin password hashes
                    └─ AES-256-GCM TTA credential vault
                              │
                              └─ TTA REST API /services/sdk/v1
                                    ├─ User session login / SSO
                                    ├─ session cache in-memory
                                    └─ Job / Activity GET endpoints
```

## Autentizace a relace

- Interní uživatel/heslo: `POST /users/sessions` s modelem `BasicAuthLogOn` (`UserName`, `Password`, `UnconditionalLogOn: false`).
- SSO: `POST /users/sessions/single-sign-on`; systémová session se předává v `Authorization`, tělo obsahuje `UserId`.
- Relace se ověřuje `POST /users/sessions/{sessionId}/validate`; odpověď se kontroluje přes `IsValid`.
- TTA session ID se posílá v hlavičce `Authorization` pro další REST volání, ukládá se jen v paměti a při změně profilu se zahodí.
- TTA vynucuje vlastní oprávnění pro joby a activity query.

## REST síťová vrstva

Výchozí API cesta je `/services/sdk/v1`; kontext například `/TotalAgility` patří do základní URL. HTTP přesměrování se odmítá, každý požadavek má timeout profilu a odpověď limit 2 MB. MCP volá pouze konkrétní GET endpointy v `callTtaApi`; obecná HTTP proxy ani libovolné REST požadavky nejsou dostupné.

Starší profily s výchozí cestou `/Services/Sdk` se při upgradu převedou na `/services/sdk/v1`; jiné ručně nastavené cesty se zachovají.

## Datové hranice a limity

SQLite DB zůstává mimo zdrojový repozitář. TTA credentials jsou šifrované AES-256-GCM; session ID se do SQLite nezapisuje. Výstupy TTA redigují citlivá pole a známé citlivé job variable hodnoty. MCP tokeny jsou omezené na připojení, ale nemají scope na jednotlivé nástroje.

Plné RBAC, více konzolových uživatelů, PostgreSQL, Docker, MCP Resources/Prompts, TTA write operace, dokumentové API, definice procesů, TTA user/group API, Designer a administrace zůstávají nepodporované.
