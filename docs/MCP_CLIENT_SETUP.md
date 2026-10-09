# Nastavení MCP klienta

## Vzdálený Streamable HTTP klient

1. V administraci otevřete **MCP klienti → Vytvořit token**.
2. Vyberte přesná TTA prostředí a dobu platnosti.
3. Zkopírujte token při vytvoření; následně jej nelze znovu načíst.
4. V MCP klientovi nastavte server `https://<veřejná-doména>/tta-mcp` a hlavičku `Authorization: Bearer <token>` prostřednictvím jeho secure secret konfigurace.

Neposílejte token v URL, příkazové historii, repozitáři ani do běžných logů. Při ztrátě vytvořte nový token a starý zneplatněte.

## Lokální stdio

Spusťte `Run-Local.ps1 -Stdio`. Přesná konfigurace klienta se liší. Obecná podoba:

```json
{
  "mcpServers": {
    "tta": {
      "command": "powershell.exe",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\Users\\pavel\\OneDrive\\Development\\Web\\TTA\\TTA MCP Server\\Run-Local.ps1",
        "-Stdio"
      ]
    }
  }
}
```

Upravte cestu podle umístění checkoutu. Klient spustí proces pod stejným Windows účtem, který vytvořil DPAPI vault klíč. Proces používá stejnou databázi a připojení jako lokální administrační UI.

## Dostupné nástroje

- `tta_connections_list` — připojení povolená tokenu, bez tajných údajů.
- `tta_connection_test` — HTTP GET test dosažitelnosti konkrétního povoleného připojení.

Nástroje pro procesy/úlohy/dokumenty nejsou zatím nabízeny jako funkční operace.
