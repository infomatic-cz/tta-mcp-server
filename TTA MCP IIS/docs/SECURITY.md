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
- Bez CORS wildcardu. `trustProxy` je vypnutý; `X-Forwarded-For` se nepoužívá pro autentizaci ani setup přístup.
- TTA URL přijímá pouze HTTPS, pokud operátor nepovolí HTTP. REST redirecty se odmítají; URL credentials/query nejsou povolené. Swagger UI odkaz lze vložit a normalizuje se na základní URL.
- Ověření certifikátu je standardně zapnuté. Volba „Důvěřovat certifikátu TTA“ se ukládá jednotlivě u profilu a používá neověřený TLS agent pouze pro toto připojení; sockety se nepoužívají opakovaně, aby zavřená upstream spojení IIS/proxy nezpůsobovala reset na dalším požadavku. Šifrování zůstává zapnuté, ale bez ověření certifikátu je možné podvržení serveru a odposlech přihlašovacích údajů; preferujte instalaci interní CA.
- MCP požadavky přes HTTP vyžadují bearer token a filtrují připojení podle jeho přiřazení.
- `tta_api_operations` čte operace pouze z REST Swaggeru nakonfigurovaného TTA hostu. Specifikace nemůže změnit cílový host ani základní URL; cesty a query parametry se validují podle spec. Žádná libovolná URL ani metoda mimo GET/POST/PUT/PATCH/DELETE nejsou povolené.
- `tta_api_read` odmítá jiné metody než GET. `tta_api_write` vyžaduje přesné zopakování `operationId` v `confirmOperationId`, je označené jako destruktivní MCP nástroj a TTA dále vynucuje oprávnění účtu. Provozovatel musí MCP klientovi přidělit jen důvěryhodný TTA účet a potvrzovat dopady write operací.
- MCP TTA odpovědi redigují známá citlivá pole a binární obsah limitují na 2 MB; API chyby nevracejí surové tělo TTA.

## První účet

Lokální režim si ponechává jednorázový setup kód dostupný jen přes loopback. IIS režim povolí průvodce prvního správce přes nakonfigurovaný HTTPS origin, jen dokud databáze neobsahuje uživatele. Host/Origin allowlist, HTTPS Secure cookie, limit požadavků a databázová transakce chrání vytvoření účtu; další pokus po založení správce je odmítnut. Každý, kdo může dosáhnout na IIS aplikaci před vytvořením prvního správce, se může pokusit účet založit. Omezte síťový/IIS přístup na správce, dokud průvodce nedokončíte.

Instalační skript ověřuje readiness a stav průvodce přes veřejnou HTTPS adresu IIS. Nečte interní port procesu, nevydává bootstrap kód a nevyžaduje lokální přístup přes port 8380.

## Audit a logy

Audit obsahuje aktéra, typ akce, ID cíle, výsledek a čas. Nepřidává vstupy formulářů, přihlašovací údaje, MCP bearer tokeny ani těla TTA požadavků. Fastify rediguje `Authorization`, `Cookie` a `Set-Cookie` hlavičky.

## Provozní požadavky pro IIS

- IIS HTTPS vazba s platným certifikátem a Windows důvěrou ke kořenové CA TTA; dynamický port Node procesu se nezveřejňuje ve firewallu.
- IIS používá samostatnou identitu aplikačního poolu; ACL odděluje release, data a logy.
- Aktualizace Windows, IIS, Node.js a HttpPlatformHandler; administrátorský přístup omezte podle zásad organizace.
- Databázi a DPAPI soubor zálohujte společně; obnovu DPAPI LocalMachine plánujte pro stejný Windows server.
- Pravidelná kontrola auditních záznamů a rotace MCP tokenů.

## Omezení ..3.1

Vzdálené OAuth, víceuživatelské role, CSRF synchronizační token, rate limit s distribuovaným úložištěm, rotace klíčů a SDK služby mimo instance-specific REST Swagger nejsou implementované. TTA endpoint, credentials a oprávnění musí být ověřeny proti cílovému tenantovi.
