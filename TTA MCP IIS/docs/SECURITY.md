# Bezpečnost

## Tajemství při uložení

- Účet správce: Argon2id hash (heslo nelze zobrazit ani obnovit).
- HTTP session: náhodný bearer cookie, v SQLite je pouze SHA-256 digest. Cookie je HttpOnly, SameSite=Strict, 12 hodin.
- MCP klientský token: náhodný tajný řetězec zobrazený při vytvoření, v SQLite je jen SHA-256 digest. Podporuje expiraci a revokaci.
- Přihlašovací údaje TTA: JSON zašifrovaný AES-256-GCM s jedinečným nonce pro každé uložení.
- `SYSTEM_SESSION_ID` se považuje za secret stejně jako heslo; v admin API se nevrací a v logu/auditu se neukládá.
- TTA session ID existuje pouze v paměti serveru, před použitím se validuje REST endpointem a polem `IsValid`; do SQLite se nikdy nezapisuje.
- Vault klíč: Windows lokální spuštění používá DPAPI chráněný soubor v uživatelském profilu; IIS používá DPAPI LocalMachine šifrovaný soubor pod `%ProgramData%\TTA MCP IIS\data`. App pool má přístup přes ACL, klíč není součástí databáze ani repozitáře.

Pro samotnou kryptografickou operaci je nutné tajemství načíst do paměti procesu. Aplikace jej nevrací v API, neloguje a při ukončení vynuluje načtený buffer.

## Ochrana HTTP

- Výchozí bind je `127.....1`; IIS HttpPlatformHandler naslouchá jen na interním dynamickém portu a obsluhuje veřejnou HTTPS vazbu IIS.
- Host allowlist, Origin allowlist pro browser požadavky, SameSite cookies, rate limit login/setup a omezená velikost JSON body.
- Bez CORS wildcardu. `trustProxy` je vypnutý; `X-Forwarded-For` se nepoužívá pro autentizaci ani kontrolu bootstrap kódu.
- TTA URL přijímá pouze HTTPS, pokud operátor nepovolí HTTP. REST redirecty se odmítají; URL credentials/query nejsou povolené. Swagger UI odkaz lze vložit a normalizuje se na základní URL.
- Ověření certifikátu je standardně zapnuté. Volba „Důvěřovat certifikátu TTA“ se ukládá jednotlivě u profilu a používá neověřený TLS agent pouze pro toto připojení. Šifrování zůstává zapnuté, ale bez ověření certifikátu je možné podvržení serveru a odposlech přihlašovacích údajů; preferujte instalaci interní CA.
- MCP požadavky přes HTTP vyžadují bearer token a filtrují připojení podle jeho přiřazení.
- MCP TTA volání jsou omezená na read-only REST allowlist; API chyby nevracejí surové tělo TTA.

## První účet

Setup kód existuje v paměti pouze při prvním spuštění bez účtu. API jej poskytne jen když socket i Host odpovídají lokálnímu přístupu a není přítomen proxy `X-Forwarded-For`. Kód není uložen ani zapisován do logu; po úspěšném založení správce zanikne.

Deploy skript získá instalační kód přímým loopback požadavkem na spuštěný proces a vypíše jej pouze do lokální administrátorské konzole. Veřejná doména k bootstrap kódu přístup nemá.

## Audit a logy

Audit obsahuje aktéra, typ akce, ID cíle, výsledek a čas. Nepřidává vstupy formulářů, přihlašovací údaje, MCP bearer tokeny ani těla TTA požadavků. Fastify rediguje `Authorization`, `Cookie` a `Set-Cookie` hlavičky.

## Provozní požadavky pro IIS

- IIS HTTPS vazba s platným certifikátem a Windows důvěrou ke kořenové CA TTA; dynamický port Node procesu se nezveřejňuje ve firewallu.
- IIS používá samostatnou identitu aplikačního poolu; ACL odděluje release, data a logy.
- Aktualizace Windows, IIS, Node.js a HttpPlatformHandler; administrátorský přístup omezte podle zásad organizace.
- Databázi a DPAPI soubor zálohujte společně; obnovu DPAPI LocalMachine plánujte pro stejný Windows server.
- Pravidelná kontrola auditních záznamů a rotace MCP tokenů.

## Omezení ..3.1

Vzdálené OAuth, víceuživatelské role, CSRF synchronizační token, rate limit s distribuovaným úložištěm, rotace klíčů, TTA write operace, dokumentové API a další version-specific adaptéry nejsou implementované. TTA endpoint, credentials a oprávnění musí být ověřeny proti cílovému tenantovi. IIS varianta potřebuje samostatné provozní ověření v cílovém prostředí před produkčním nasazením.
