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
- `tta_connection_test` — TTA REST login a kontrola `IsValid` pro povolené připojení.
- `tta_jobs_list`, `tta_jobs_count` — čtení jobů přes pojmenované TTA query.
- `tta_job_details`, `tta_job_state`, `tta_job_history`, `tta_job_events`, `tta_job_variables` — read-only informace o jobu.
- `tta_activities_query`, `tta_activities_workqueue`, `tta_activities_count` — read-only TTA activity query a workqueue.

Připojení musí být nakonfigurované a otestované v admin konzoli. TTA odpovědi respektují účetní oprávnění. Query názvy před voláním vytvořte v TotalAgility. Zápis, dokumenty, uživatelé, procesní definice a Designer nejsou v 0.2.1 vystavené.
