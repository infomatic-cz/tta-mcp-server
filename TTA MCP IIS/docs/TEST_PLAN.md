# Plán ověřování

Plán popisuje ověřitelné schopnosti dostupné v aplikaci a dokumentaci. Neoznačuje žádnou TTA verzi jako kompatibilní.

| Oblast | Ověření požadované před produkčním víceuživatelským provozem |
|---|---|
| Build | Čistý Windows x64 build ze source mirroru mimo OneDrive a kontrola obsahu IIS ZIP balíčku. |
| První účet | IIS průvodce přes HTTPS bez lokálního portu, setup jen při prázdném seznamu uživatelů, souběžné/duplicitní založení; lokální režim s loopback setup kódem. |
| Přihlášení | Argon2id ověření, chybné heslo, rate limit, expirace/revokace session, cookie flags. |
| Tajemství | AES-GCM roundtrip, změna ciphertextu, DB bez vault key, logy bez secretů, Windows DPAPI lifecycle a ACL IIS aplikačního poolu. |
| API | CSRF/Origin, Host header, login throttling, URL validace, body limit, audit sanitizace. |
| MCP | SDK handshake, tool list/call, HTTP bearer validation, token scope izolace, expiry/revocation, stdio framing. |
| SQLite | Schéma, WAL, souběžný přístup, backup/restore, disk full. |
| TTA adaptér | Swagger discovery v2, stránkování a filtering; GET/JSON/formData/binary operace; request path/body validation; connection scope; write confirmation; redirects, TLS, timeout, connection reset stage diagnostics. |
| UI | První setup, login, připojení CRUD, token create/revoke, menší viewport a přístupnost. |
| IIS | AppCmd discovery, HTTPS binding 443, virtuální cesta, předání `HTTP_PLATFORM_PORT`, pool identity/ACL, šifrování hesla custom identity, health endpointy a rollback. |

Před každým skutečným TTA testem používat testovací instalaci. Zápisové a destruktivní metody zkoušet jen na izolovaných datech a po ověření dopadu konkrétního operationId. Každá metoda zůstává omezená na endpointy deklarované Swaggerem a účetní oprávnění TTA.
