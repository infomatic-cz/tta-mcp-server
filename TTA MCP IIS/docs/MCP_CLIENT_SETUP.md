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
        "<cesta k projektu v OneDrive>\\Run-Local.ps1",
        "-Stdio"
      ]
    }
  }
}
```

Nahraďte zástupný text cestou k projektu uloženému ve složce OneDrive. Klient spustí proces pod stejným Windows účtem, který vytvořil DPAPI vault klíč. Proces používá stejnou databázi a připojení jako lokální administrační UI.

## Dostupné nástroje

- `tta_connections_list` — připojení povolená tokenu, bez tajných údajů.
- `tta_connection_test` — TTA REST login a kontrola `IsValid` pro povolené připojení.
- `tta_api_operations` — stránkovaný seznam operací, metod, cest a parametrů z konkrétního TTA REST Swaggeru.
- `tta_api_read` — volá pouze Swaggerem deklarované GET operace.
- `tta_api_write` — volá Swaggerem deklarované POST/PUT/PATCH/DELETE operace; klient musí zobrazit destruktivní anotaci a `confirmOperationId` musí přesně odpovídat operationId.
- `tta_jobs_list`, `tta_jobs_count` — čtení jobů přes pojmenované TTA query.
- `tta_job_details`, `tta_job_state`, `tta_job_history`, `tta_job_events`, `tta_job_variables` — read-only informace o jobu.
- `tta_activities_query`, `tta_activities_workqueue`, `tta_activities_count` — read-only TTA activity query a workqueue.

Příklad průzkumu: zavolejte `tta_api_operations` s `connectionId` a případně `search: "job"`. Pak použijte vrácené `operationId` a hodnoty v `pathParameters`, `queryParameters`, `headerParameters` nebo `body`. U write operace zavolejte `tta_api_write` s `confirmOperationId` nastaveným na stejné `operationId`. FormData file vložte jako `{ "fileName": "document.pdf", "contentType": "application/pdf", "dataBase64": "..." }`. Upload i odpovědi mají limit 2 MB.

Připojení musí být nakonfigurované a otestované v admin konzoli. TTA odpovědi respektují účetní oprávnění. Query názvy před voláním vytvořte v TotalAgility. Dynamické nástroje pokrývají operace vystavené v REST Swaggeru daného připojení; SDK služby, které v tomto Swaggeru nejsou, nejsou automaticky volatelné.
