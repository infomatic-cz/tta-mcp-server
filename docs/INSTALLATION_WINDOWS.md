# Instalace a spuštění ve Windows

## Požadavky

- Windows 10/11 x64
- PowerShell 7.x
- Node.js 22.15+ nebo 24 LTS a npm
- Otevřený HTTPS přístup z počítače ke každé instalaci TTA, kterou chcete zkoumat

## První spuštění

1. Otevřete PowerShell v kořeni projektu.
2. Spusťte `Set-ExecutionPolicy -Scope Process Bypass`.
3. Spusťte `./Run-Local.ps1`.
4. Počkejte na stránku `http://127.0.0.1:8380`.
5. Na obrazovce prvního nastavení zkopírujte jednorázový kód a vytvořte správce. Heslo musí mít minimálně 12 znaků.

Kód se nepersistuje ani nevypisuje do logu. Server jej vrátí pouze lokálnímu socketu při prvním spuštění; po založení správce přestane být dostupný. Databáze je v `%LOCALAPPDATA%\TTA MCP Server\tta-mcp.sqlite`. Vault klíč je v tomtéž adresáři uložen ve formátu DPAPI chráněném aktuálním účtem Windows. Aplikace a její závislosti jsou v `C:\Temp\TTAMCP-Build`.

Při dalších spuštěních se přihlaste vytvořeným účtem. `Ctrl+C` ukončí běžící proces. Lokální běh používá HTTP pouze na loopbacku; nepublikujte port 8380 do sítě.

## Nový build

```powershell
./New-Build.ps1
```

Skript vytvoří dočasnou kopii zdrojů, provede `npm ci`, TypeScript kompilaci a Vite build mimo OneDrive. Produkční výstup připraví v `C:\Temp\TTAMCP-Build\release`.

## stdio MCP klient

Lokální klient může spustit `Run-Local.ps1 -Stdio`. Skript odemkne DPAPI klíč pouze pro proces Node, vynuluje proměnnou v PowerShellu při ukončení a MCP protokol posílá přes stdout. Protokol nekontaminují diagnostické výpisy.

## Záloha

Při zastaveném serveru zálohujte celý adresář `%LOCALAPPDATA%\TTA MCP Server`. Záloha DB bez příslušného DPAPI klíče neumožní dešifrovat uložená TTA tajemství. DPAPI klíč nelze přenést na jiný Windows účet; před migrací vytvořte nové TTA credentials a nový lokální vault.
