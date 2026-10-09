# Capability registry

Capabilities se neodvozují pouze z čísla verze. Ověření připojení aktualizuje pouze `tta.sdk.json` a `tta.auth.session`. Dostupnost každé doménové metody závisí na SDK verzi, URL a oprávněních TTA účtu.

| Capability / MCP tool | Riziko | Stav implementace | Poznámka |
|---|---|---|---|
| `tta.sdk.json`, `tta.auth.session` | READ | Po testu `SUPPORTED` | Test zavolá UserService login/session a `ValidateSession`. |
| `tta_connections_list`, `tta_connection_test` | READ | `AVAILABLE` | MCP token musí mít přiřazené TTA prostředí. |
| `tta_processes_list` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | `ProcessService.GetProcessesSummary`; výsledky respektují přístup TTA účtu. |
| `tta_process_details` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | `GetProcessInfo2`, bez anotací/příloh. |
| `tta_process_help`, `tta_process_states` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Metadatové čtení procesní definice. |
| `tta_job_state`, `tta_job_history`, `tta_job_events` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Čtení konkrétní job instance podle ID. |
| `tta_job_activities` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Čtení aktivit z konkrétní job instance a stavu. |
| `process.start`, `job.write`, `activity.write` | WRITE / DESTRUCTIVE | `UNSUPPORTED` | Zápis není vystaven, dokud nebude dokončena operace autorizace a potvrzování. |
| `document.read`, `document.write` | READ / WRITE | `UNSUPPORTED` | Dokumenty a binární data nejsou implementované. |
| `user.read`, `group.read`, `system.read` | READ | `UNSUPPORTED` | Zatím nejsou MCP nástroje pro administraci TTA. |
| `form.design.*`, `process.design.*`, `administration.*` | WRITE / ADMIN | `UNSUPPORTED` | Designer a administrativní operace nejsou vystavené. |
| OAuth, browser federation, Windows authentication | AUTH | `UNSUPPORTED` | Aktuální release podporuje interní heslo a `SYSTEM_SESSION_ID` SSO režim. |

`IMPLEMENTED_NOT_TENANT_VERIFIED` znamená, že nástroj volá doloženou oficiální SDK metodu, ale konkrétní tenant v tomto prostředí nebyl k dispozici pro runtime ověření. TTA může volání odmítnout na základě oprávnění nebo odlišné konfigurace endpointu.
