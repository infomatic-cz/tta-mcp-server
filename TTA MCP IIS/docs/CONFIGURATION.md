# Konfigurace

Žádný `.env` soubor se nevytváří ani nečte. Konfiguraci předává procesní prostředí; tajemství poskytuje samostatné runtime secret úložiště.

| Proměnná | Výchozí | Význam |
|---|---|---|
| `TTA_HOST` | `127.0.0.1` | Adresa bindu. Pro jinou než loopback adresu je povinný `TTA_PUBLIC_ORIGIN`. |
| `TTA_PORT` | `8380` | HTTP port; na IIS se použije dynamická hodnota `HTTP_PLATFORM_PORT`, kterou předá IIS HttpPlatformHandler. |
| `TTA_BASE_PATH` | prázdná | IIS cesta aplikace, například `/tta-mcp`; UI, API, health URL, cookies a MCP endpoint ji respektují. |
| `TTA_DATA_DIR` | `%LOCALAPPDATA%\TTA MCP IIS` | Databázový adresář; uchovávejte mimo zdrojový repozitář. IIS deploy jej ukládá do `%ProgramData%\TTA MCP IIS\data`. |
| `TTA_VAULT_KEY` | — | Dočasné base64 32B tajemství v procesu. Používejte jen při DPAPI lokálním spuštění. |
| `TTA_VAULT_KEY_FILE` | — | Cesta k runtime credential souboru. Soubor musí obsahovat base64 32B klíč. IIS používá DPAPI variantu níže. |
| `TTA_VAULT_KEY_DPAPI_FILE` | — | Windows IIS cesta k DPAPI LocalMachine šifrovanému souboru s vault klíčem. Klíč z něj před startem načte Windows DPAPI; plaintext se na disk nezapisuje. |
| `TTA_PUBLIC_ORIGIN` | — | Veřejný HTTPS origin aplikace, bez cesty IIS aplikace, například `https://tta-mcp.example.cz`. |
| `TTA_COOKIE_SECURE` | podle `TTA_PUBLIC_ORIGIN` | Přidá atribut Secure session cookie. Vzdálený provoz musí mít `true`. |
| `TTA_ALLOW_INSECURE_HTTP` | `false` | Výslovně povolí HTTP adresy TTA. Používejte jen v důvěryhodné interní síti. |
| `LOG_LEVEL` | `info` | Úroveň Pino logování. |

Vault klíč musí být base64 kódování přesně 32 náhodných bajtů. Klíč se při startu načte do paměti; procesní kopie proměnné `TTA_VAULT_KEY` se ihned odstraní. Restart se stejným klíčem je nutný k dešifrování existujících TTA credentials.

IIS šablona výslovně předává Node.js hodnotu `%HTTP_PLATFORM_PORT%`, kterou HttpPlatformHandler dynamicky přidělí; `TTA_PORT` má před ní přednost. Veřejná HTTPS komunikace končí v IIS. Pro IIS virtuální aplikaci nastaví instalátor `TTA_BASE_PATH` podle její cesty, například `/tta-mcp`; veřejný MCP endpoint pak bude `https://tta-mcp.example.cz/tta-mcp/tta-mcp`.

TTA základní URL, cestu REST API (výchozí `/services/sdk/v1`) a způsob autentizace (`PASSWORD` nebo `SYSTEM_SESSION_ID`) nastavte pro každé připojení v admin konzoli. Pokud Swagger ukazuje `basePath: /TotalAgility`, zahrňte tento kontext do základní URL a ponechte cestu REST API `/services/sdk/v1`. `SYSTEM_SESSION_ID` je šifrované tajemství, které se nikdy nevrací do API; při SSO se předává pouze v autorizační hlavičce TTA.
