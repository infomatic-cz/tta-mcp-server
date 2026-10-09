# Architektura

Verze 0.2.0 přidává sdílený TTA SDK JSON klient, dva způsoby získání session a omezený read-only katalog. Není to plná implementace všech funkcí z `CODEX_README.md`.

```text
MCP Streamable HTTP / stdio
          │
          ├─ MCP token → připojovací scope
          ├─ read-only nástroj allowlist
          └─ audit bez vstupních secrets
                    │
React UI ──> Fastify admin API
                    │
                    ├─ SQLite profiles, sessions, tokens, audit
                    ├─ Argon2id admin password hashes
                    └─ AES-256-GCM TTA credential vault
                              │
                              └─ TTA SDK JSON POST
                                    ├─ UserService session
                                    ├─ session cache in-memory
                                    └─ ProcessService / JobService / ActivityService
```

## Autentizace a relace

- Interní username/password používá `UserService.GetSessionWithPassword`.
- SSO/system session používá `GetSingleSignOnSession(systemSessionId, userIdentity)`.
- Oba režimy validují získanou relaci pomocí `ValidateSession`.
- Session ID zůstává pouze v paměťové cache procesu a při změně profilu se odstraní.
- TTA oprávnění dále vynucuje samotná TTA instalace pro použitý účet.

## Síťová vrstva

SDK JSON volání jsou HTTP POST s JSON payloadem podle oficiálního kontraktu metody. Cesta SDK je konfigurovatelná; výchozí `/Services/Sdk` se připojí k základní URL. Přesměrování se odmítá, každé volání má timeout podle připojení a odpověď má limit 2 MB. Není zde obecný HTTP proxy ani volání libovolné TTA SDK metody: `callTtaSdk` kontroluje allowlist.

## Datové hranice a limity

SQLite DB zůstává mimo zdrojový repozitář. TTA credentials jsou šifrované AES-256-GCM; session ID se do SQLite nezapisuje. MCP tokeny jsou omezené na připojení, ale současná verze nemá token scope na jednotlivé read-only nástroje.

V 0.2.0 chybí plné RBAC, správa dalších konzolových uživatelů, PostgreSQL, Docker, MCP Resources/Prompts, TTA write operace, dokumentové API, TTA user/group API, Designer a administrativa. Tyto položky zůstávají v capability registry jako `UNSUPPORTED`.
