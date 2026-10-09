# Konfigurace

Žádný `.env` soubor se nevytváří ani nečte. Konfiguraci předává procesní prostředí; tajemství poskytuje samostatné runtime secret úložiště.

| Proměnná | Výchozí | Význam |
|---|---|---|
| `TTA_HOST` | `127.0.0.1` | Adresa bindu. Pro jinou než loopback adresu je povinný `TTA_PUBLIC_ORIGIN`. |
| `TTA_PORT` | `8080` | HTTP port. |
| `TTA_DATA_DIR` | `%LOCALAPPDATA%\TTA MCP Server` / `~/.local/share/tta-mcp-server` | Databázový adresář; uchovávejte mimo zdrojový repozitář. |
| `TTA_VAULT_KEY` | — | Dočasné base64 32B tajemství v procesu. Používejte jen při DPAPI lokálním spuštění. |
| `TTA_VAULT_KEY_FILE` | — | Cesta k runtime credential souboru, např. systemd `%d/tta-vault-key`. Soubor musí obsahovat base64 32B klíč. |
| `TTA_PUBLIC_ORIGIN` | — | HTTPS origin reverse proxy, např. `https://tta-mcp.example.cz`. |
| `TTA_COOKIE_SECURE` | podle `TTA_PUBLIC_ORIGIN` | Přidá atribut Secure session cookie. Vzdálený provoz musí mít `true`. |
| `TTA_ALLOW_INSECURE_HTTP` | `false` | Výslovně povolí HTTP adresy TTA. Používejte jen v důvěryhodné interní síti. |
| `LOG_LEVEL` | `info` | Úroveň Pino logování. |

Vault klíč musí být base64 kódování přesně 32 náhodných bajtů. Klíč se při startu načte do paměti; procesní kopie proměnné `TTA_VAULT_KEY` se ihned odstraní. Restart se stejným klíčem je nutný k dešifrování existujících TTA credentials.
