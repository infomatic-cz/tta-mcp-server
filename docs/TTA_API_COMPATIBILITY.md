# Kompatibilita TTA API

Tato tabulka shrnuje doložené API kontrakty. Dokumentační shoda nenahrazuje test proti konkrétnímu tenantovi; TTA může omezovat metody i přístupová práva podle instalace, typu nasazení a účtu.

| Verze | Oficiální API zdroj | Zjištěné autentizační metody | Stav v 0.2.0 |
|---|---|---|---|
| 8.0 | [SDK dokumentace 8.0](https://docshield.tungstenautomation.com/KTA/en_US/8.0.0-ivy45l9g96/help/SDK_Documentation/latest/index.html) | `GetSessionWithPassword`, `GetSingleSignOnSession`, `ValidateSession` | Kontrakty UserService jsou zdokumentované; běhově neověřeno. |
| 8.1 | [SDK UserService 8.1](https://docshield.tungstenautomation.com/KTA/en_US/8.1.0-rmx0b1ux3q/help/SDK_Documentation/latest/class_agility_1_1_sdk_1_1_services_1_1_user_service.html) | Username/password session, system session ID, validace session | Kontrakty UserService jsou zdokumentované; běhově neověřeno. |
| 2025.2 | [SDK UserService 2025.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2025.2-b103T2xQ9l/help/SDK_Documentation/latest/class_agility_1_1_sdk_1_1_services_1_1_user_service.html) a [volání SDK přes JSON](https://docshield.tungstenautomation.com/TotalAgility/en_US/2025.2-b103T2xQ9l/help/SDK_Documentation/latest/webservicecallusingjson.html) | `GetSessionWithPassword`, `GetSingleSignOnSession`, `ValidateSession` | JSON POST a autentizační metody zdokumentované; běhově neověřeno. |
| 2026.1 | [SDK UserService 2026.1](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.1-sy4i5uG9Tu/help/SDK_Documentation/latest/class_agility_1_1_sdk_1_1_services_1_1_user_service.html) | Username/password session, system session ID, validace session | Kontrakty UserService jsou zdokumentované; běhově neověřeno. |
| 2026.2 | [SDK UserService 2026.2](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.2-ru7bs8vbsd/help/SDK_Documentation/latest/class_agility_1_1_sdk_1_1_services_1_1_user_service.html) | Username/password session, system session ID, validace session | Kontrakty UserService jsou zdokumentované; běhově neověřeno. |
| 2026.3 | [SDK UserService 2026.3](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.3-xw9na1myhb/help/SDK_Documentation/latest/class_agility_1_1_sdk_1_1_services_1_1_user_service.html) a [SDK přehled](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.3-xw9na1myhb/help/SDK_Documentation/fullbuild/index.html) | `GetSessionWithPassword`, `GetSingleSignOnSession`, `ValidateSession` | Kontrakty a SDK JSON rozhraní zdokumentované; běhově neověřeno. |
| 2026.4+ | Zatím bez cílové dokumentace v zadání | Neověřeno | Není deklarována kompatibilita. |

## Autentizace

Výchozí režim `PASSWORD` volá `UserService.GetSessionWithPassword` s objektem `UserIdentityWithPassword`. SDK vrátí `Session`; následně se volá `UserService.ValidateSession`. Jméno, heslo i session ID se posílají pouze server-to-server přes SDK JSON POST.

Režim `SYSTEM_SESSION_ID` volá `UserService.GetSingleSignOnSession(systemSessionId, userIdentity)`. Tato metoda vrací session uživatele pro systémové session ID; uživatelské jméno a logon protocol jsou povinné. `SYSTEM_SESSION_ID` je volitelný vstup SSO, nikoliv požadavek pro běžnou interní username/password autentizaci.

Logon protocol lze zvolit jako `5` (Designer), `7` (Internet, výchozí) nebo `8` (Transformation IDE). Dokumentace uvádí `7` jako Internet. Cloudové připojení s interním heslem má začít s `7`.

Session ID se ukládá jen do paměťové cache procesu, ověřuje se před použitím a zahazuje se při změně či odebrání připojení. Databáze obsahuje jen AES-256-GCM šifrované TTA credentials a nevrací je do admin API.

## SDK JSON endpoint

Oficiální ukázka SDK JSON používá HTTP POST, JSON payload podle parametrů metody a cestu ve tvaru `Services/Sdk/UserService.svc/json/LogOnWithPassword2`. Aplikace má výchozí cestu `/Services/Sdk`; cesta je konfigurovatelná, protože cloud a on-premise mohou mít jiný kořen nebo kontextovou cestu. Redirect se nepovoluje.

Test připojení prokazuje, že nakonfigurovaný JSON endpoint zvládl získat a ověřit TTA relaci. Neprovádí procesní změny. Test sám neprokazuje přístup ke každé metodě; ten se ověřuje až při volání konkrétního read-only nástroje.

## Implementované read-only operace

V 0.2.0 je přes SDK JSON povoleno pouze toto omezené allowlist API:

- `ProcessService.GetProcessesSummary`
- `ProcessService.GetProcessInfo2` s `processInfoFilter=0` (bez příloh a anotací)
- `ProcessService.GetProcessHelpText`
- `ProcessService.GetProcessStatesSummary`
- `JobService.GetJobState`, `GetJobHistory2`, `GetJobEvents`
- `ActivityService.GetActivitiesInJobWithStatus`

SDK odpovědi jsou omezené na 2 MB a před vrácením do MCP se redigují pole s klíči jako `Password`, `Token`, `Credential` a `SessionId`. Neznámé nebo nezdokumentované SDK metody nejsou přes server volatelné.

## Omezení

Nebylo možné se připojit k uživatelovu cloud tenantovi z tohoto vývojového prostředí, proto není potvrzená konkrétní URL, interní účet ani přístupová práva. Metody dokumentované pro SDK verzí se nesmějí považovat za runtime ověřené. TTA RESTful endpointy KTA 8.x, SOAP, federované přihlášení přes browser/OAuth, Windows integrované přihlášení a zápisové operace nejsou v 0.2.0 implementovány.
