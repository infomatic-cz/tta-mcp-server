# Kompatibilita TTA API

## Swagger instance uživatele

Konektor 0.2.8 vychází z [TTA REST Swaggeru](https://winserver-tta26.im.cz/TotalAgility/swagger/ui/index#/Job), který uživatel poskytl, a z jeho [OpenAPI v1 JSON](https://winserver-tta26.im.cz/TotalAgility/swagger/docs/v1). Specifikace uvádí `basePath: /TotalAgility`, HTTPS a REST cesty `/services/sdk/v1/...`. Samotný Swagger neuvádí produktovou verzi TTA; název hostitele se za důkaz verze nepovažuje.

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

### Implementované read-only REST operace

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

Vstupy jsou validované, cesty jsou pevně dané allowlistem, TTA oprávnění zůstávají vynucená cílovým serverem. Odpovědi mají limit 2 MB a výstupy redigují citlivá pole i hodnoty proměnných, jejichž názvy obsahují například `password`, `secret`, `token` nebo `credential`.

Swagger tohoto serveru neobsahuje endpointy pro seznam definic procesů a jejich Designer metadata, proto je konektor již nenabízí pod nesprávnými SDK názvy. REST API obsahuje i write endpointy, ale tento MCP server je nevystavuje.

## Ostatní požadované verze

Oficiální SDK dokumentace existuje pro [8.0](https://docshield.tungstenautomation.com/KTA/en_US/8.0.0-ivy45l9g96/help/SDK_Documentation/latest/index.html), [8.1](https://docshield.tungstenautomation.com/KTA/en_US/8.1.0-rmx0b1ux3q/help/SDK_Documentation/latest/index.html), [2025.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2025.2-b103T2xQ9l/help/SDK_Documentation/latest/index.html), [2026.1](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.1-sy4i5uG9Tu/help/SDK_Documentation/latest/index.html), [2026.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.2-ru7bs8vbsd/help/SDK_Documentation/latest/index.html) a [2026.3](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.3-xw9na1myhb/help/SDK_Documentation/latest/index.html). Kontrakty z REST Swaggeru konkrétní instance nelze automaticky prohlásit za shodné se všemi verzemi. Tyto verze zůstávají bez runtime ověření; konfigurace API path umožňuje odlišný prefix, nikoli nekompatibilní API kontrakt.

## Omezení ověření

Swagger JSON na dodané URL byl načten a jeho cesty/modely jsou základem opravy. Přihlášení proti této instalaci nebylo provedeno, protože nebyly poskytnuty přihlašovací údaje — aniž by se ukládaly do kódu nebo konverzace. Úspěšný test 0.2.1 potvrdí REST login a `IsValid`; přístup ke konkrétním jobům a aktivitám je nutné ověřit jejich MCP nástroji pod účtem TTA.
