# Architektura

Verze 0.1.2 je první dokončená technická etapa, nikoliv plná integrace TotalAgility.

```text
React UI ──same-origin──> Fastify admin API ──> SQLite
                                  │                 ├─ password hashes
                                  │                 ├─ hashed sessions/tokens
                                  │                 ├─ encrypted TTA credentials
                                  │                 └─ audit events
                                  ├─ AES-256-GCM vault key (runtime only)
                                  └─ MCP Streamable HTTP / stdio
                                           │
                                           └─ TTA HTTP reachability probe
```

## Stack

- Node.js 22/24 LTS, TypeScript strict mode, Fastify 5.
- React 19 + Vite 8; produkční UI se kompiluje do `dist/web` a obsluhuje jej Fastify.
- Oficiální TypeScript MCP SDK v2, Streamable HTTP přes `createMcpHandler` a lokální `stdio` transport.
- SQLite přes `better-sqlite3`, s WAL, foreign keys a busy timeout. Databáze je mimo repozitář.
- Argon2id pro hesla; AES-256-GCM pro tajné hodnoty TTA; SHA-256 digest pro náhodné sessions/MCP tokeny.

## Datové hranice

TTA profily a audit ukládá Fastify vrstva. MCP volání používá stejný profil a autorizační pravidla; každý vzdálený token má explicitní seznam povolených ID připojení. TTA API adaptér zatím neexistuje. Jediný síťový dotaz je administrátorem vyvolaný HTTP GET bez přihlašovacích údajů a bez následování redirectů.

## Provoz

Lokální proces naslouchá na `127.0.0.1`. Vzdálený proces také naslouchá pouze na loopbacku a je dostupný přes TLS reverse proxy. systemd zprostředkuje odemčený vault klíč jako runtime credential. Výpadek jednoho TTA serveru nezastaví administrační server.

## Rozhodnutí, která je nutné rozšířit

- Ověřit oficiální SDK JSON/SOAP/REST kontrakty pro cílové verze; pak přidat `TtaAdapter` a capability registry.
- Přidat skutečné víceuživatelské role a delegaci připojení. 0.1.2 obsahuje jen systémového správce a omezení vzdálených MCP tokenů.
- Přidat PostgreSQL, migrace, zálohy/obnovu, monitoring a testovací sadu před produkčním víceinstančním provozem.
