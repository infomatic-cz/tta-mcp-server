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
- `tta_connection_test` — TTA SDK login a validace session pro konkrétní povolené připojení.
- `tta_processes_list`, `tta_process_details`, `tta_process_help`, `tta_process_states` — read-only procesní metadata.
- `tta_job_state`, `tta_job_history`, `tta_job_events`, `tta_job_activities` — read-only informace o konkrétním jobu.

Připojení musí být nakonfigurované a otestované v admin konzoli. TTA odpovědi respektují účetní oprávnění. Zápis, dokumenty, uživatelé a Designer nejsou v 0.2.0 vystavené.
