# Plán ověřování

Plán vychází z `CODEX_README.md`. Neoznačuje žádnou TTA verzi jako kompatibilní.

| Oblast | Ověření požadované před produkčním víceuživatelským provozem |
|---|---|
| Build | Čistý build ze source mirroru mimo OneDrive na Windows a Linuxu. |
| První účet | Jednorázový lokální setup, neplatný kód, vypršení kódu, duplicitní setup. |
| Přihlášení | Argon2id ověření, chybné heslo, rate limit, expirace/revokace session, cookie flags. |
| Tajemství | AES-GCM roundtrip, změna ciphertextu, DB bez vault key, logy bez secretů, DPAPI/systemd credential lifecycle. |
| API | CSRF/Origin, Host header, login throttling, URL validace, body limit, audit sanitizace. |
| MCP | SDK handshake, tool list/call, HTTP bearer validation, token scope izolace, expiry/revocation, stdio framing. |
| SQLite | Schéma, WAL, souběžný přístup, backup/restore, disk full. |
| TTA adaptér | Každá metoda ověřena proti oficiálnímu SDK/REST kontraktu a konkrétní verzi instalace. |
| UI | První setup, login, připojení CRUD, token create/revoke, menší viewport a přístupnost. |

Před každým skutečným TTA testem používat testovací instalaci a pouze bezpečné čtecí operace. Destruktivní operace nejsou implementovány.
