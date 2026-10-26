# Kompatibilita TTA API

## Swagger instance uživatele

Konektor byl původně ověřen proti [TTA REST Swaggeru](https://winserver-tta26.im.cz/TotalAgility/swagger/ui/index#/Job) a jeho [OpenAPI v1 JSON](https://winserver-tta26.im.cz/TotalAgility/swagger/docs/v1). Verze 0.3.5 načítá stejný kontrakt dynamicky z každého připojení. Příklad specifikace uvádí `basePath: /TotalAgility` a REST cesty `/services/sdk/v1/...`; samotný Swagger neuvádí produktovou verzi TTA.

| Vlastnost | Hodnota z OpenAPI |
|---|---|
| Název | Tungsten TotalAgility REST API |
| Swagger | 2.0, API `v1` |
| Base path | `/TotalAgility` |
| Interní přihlášení | `POST /services/sdk/v1/users/sessions` |
| Validace relace | `POST /services/sdk/v1/users/sessions/{sessionId}/validate` |
| API jobů | `/services/sdk/v1/jobs/...` |
| API aktivit | `/services/sdk/v1/activities/...` |

### Autentizace podle Swaggeru

Interní autentizace posílá JSON objekt `BasicAuthLogOn`:

```json
{
  "UserName": "tta-user",
  "Password": "...",
  "UnconditionalLogOn": false
}
```

Odpověď `UserSession` obsahuje `SessionId` a `LogOnStateType`. Hodnota `0` znamená `LoggedOn`; ostatní stavy, například změna hesla nebo zámek účtu, nejsou považovány za úspěšné přihlášení. Poté se volá validační endpoint. Jeho model `UserSessionValidation` vrací `IsValid`, `ResourceId` a `DisplayName` — **nevrací `SessionId`**. To byla jedna chyba předchozí implementace.

Pro další chráněné REST operace Swagger vyžaduje hlavičku `Authorization` s TTA session ID. OAuth access token se předává jako `Bearer <token>`. Alternativní SSO metoda je `POST /users/sessions/single-sign-on`: `SYSTEM_SESSION_ID` patří do hlavičky `Authorization` a tělo obsahuje `{ "UserId": "..." }`. Nejde tedy o parametr `systemSessionId` v těle SDK JSON požadavku.

### Proč předchozí verze nefungovala

Verze 0.2.0 posílala požadavky na WCF/SDK JSON adresy jako `/Services/Sdk/UserService.svc/json/GetSessionWithPassword`. Dodaný Swagger popisuje pro tuto instanci REST rozhraní na `/services/sdk/v1/...`. Předchozí validace navíc očekávala `SessionId` z odpovědi validate, zatímco Swaggerův model vrací `IsValid`. Obě chyby jsou opravené v 0.2.1.

### Pojmenované read-only REST operace

| MCP nástroj | TTA endpoint | Parametry |
|---|---|---|
| `tta_jobs_list` | `GET /jobs` | `queryName` — uložený TTA job query |
| `tta_jobs_count` | `GET /jobs/count` | `queryName` |
| `tta_job_details` | `GET /jobs/{jobId}` | `jobId`, volitelně historie přidružených jobů |
| `tta_job_state` | `GET /jobs/{jobId}/state` | `jobId` |
| `tta_job_history` | `GET /jobs/{jobId}/history` | `jobId`, volitelně přidružené joby |
| `tta_job_variables` | `GET /jobs/{jobId}/variables` | `jobId` |
| `tta_job_events` | `GET /jobs/{jobId}` | Události z vlastnosti `Events` |
| `tta_activities_query` | `GET /activities/{queryName}` | Uložený TTA activity query |
| `tta_activities_workqueue` | `GET /activities/workqueue` | `queryName`; TTA uplatní role a dovednosti uživatele |
| `tta_activities_count` | `GET /activities/count` | `queryName`, `jobId` nebo `activityStatus` |

Tyto pojmenované nástroje zůstávají pohodlnou typovanou zkratkou. Vstupy jsou validované, cesty jsou pevně dané a TTA oprávnění vynucuje cílový server.

### Dynamické REST Swagger nástroje

MCP `tta_api_operations` získá `GET {baseUrl}/swagger/docs/v1` s TTA session ID a vrátí stránkovaný seznam operací. `tta_api_read` volá pouze operace `GET`. `tta_api_write` volá deklarované `POST`, `PUT`, `PATCH` a `DELETE` operace; vyžaduje přesné zopakování operationId v `confirmOperationId` a nese MCP anotaci `destructiveHint`. Cesta, HTTP metoda a parametry se berou ze Swaggeru, ne ze vstupu klienta. Host z definice se ignoruje a požadavek zůstává na nakonfigurovaném TTA originu.

Vstupy zahrnují path/query/header parametry, JSON body a Swagger 2 `formData` včetně souboru s `fileName`, `contentType` a `dataBase64`. Binární odpovědi se vracejí jako base64. Request i response jsou omezené na 2 MB; redirecty se odmítají a známá citlivá pole se před návratem redigují. Přístup ke každému endpointu nadále určuje TTA účet.

Dynamická plocha zahrnuje všechny podporované operace, které konkrétní REST Swagger deklaruje. Pokud daná instance ve Swaggeru nemá dokumentové, uživatelské, procesní nebo Designer endpointy, není možné je přes tyto REST nástroje volat. Toto není totéž co kompletní Tungsten SDK: oficiální SDK dokumentuje další servisní metody a také samostatné HTTP JSON/SOAP služby, které instance REST Swaggeru nemusí vystavovat.

## Ostatní požadované verze

Oficiální SDK dokumentace existuje pro [8.0](https://docshield.tungstenautomation.com/KTA/en_US/8.0.0-ivy45l9g96/help/SDK_Documentation/latest/index.html), [8.1](https://docshield.tungstenautomation.com/KTA/en_US/8.1.0-rmx0b1ux3q/help/SDK_Documentation/latest/index.html), [2025.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2025.2-b103T2xQ9l/help/SDK_Documentation/latest/index.html), [2026.1](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.1-sy4i5uG9Tu/help/SDK_Documentation/latest/index.html), [2026.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.2-ru7bs8vbsd/help/SDK_Documentation/latest/index.html) a [2026.3](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.3-xw9na1myhb/help/SDK_Documentation/latest/index.html). Kontrakty z REST Swaggeru konkrétní instance nelze automaticky prohlásit za shodné se všemi verzemi. Tyto verze zůstávají bez runtime ověření; konfigurace API path umožňuje odlišný prefix, nikoli nekompatibilní API kontrakt.

## Omezení ověření

Swagger JSON na dodané URL byl načten a jeho cesty/modely jsou základem opravy. Přihlášení proti této instalaci nebylo provedeno, protože nebyly poskytnuty přihlašovací údaje — aniž by se ukládaly do kódu nebo konverzace. Úspěšný test 0.2.1 potvrdí REST login a `IsValid`; přístup ke konkrétním jobům a aktivitám je nutné ověřit jejich MCP nástroji pod účtem TTA.
