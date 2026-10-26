# Capability registry

Schopnosti se neodvozují pouze z čísla verze. Test připojení ověřuje REST autentizaci a relaci. Úspěšný login nezaručuje oprávnění ke každému jobu nebo activity query; ty vynucuje TTA účet.

| Capability / MCP nástroj | Riziko | Stav | Poznámka |
|---|---|---|---|
| `tta.rest.v1`, `tta.auth.session` | READ | Po testu `SUPPORTED` | Kontrakty ověřené podle OpenAPI Swaggeru konkrétní instance; autentizace nebyla proti tenantovi spuštěna. |
| `tta_connections_list`, `tta_connection_test` | READ | `AVAILABLE` | MCP token musí mít přiřazené TTA prostředí. |
| `tta_api_operations` | READ | `AVAILABLE_AFTER_TTA_AUTH` | Načte operace/metody/parametry ze Swaggeru konkrétního TTA serveru. |
| `tta_api_read` | READ | `DYNAMIC_FROM_SWAGGER` | Volá jen deklarované GET operace. |
| `tta_api_write` | WRITE / DESTRUCTIVE | `DYNAMIC_FROM_SWAGGER` | Volá deklarované POST/PUT/PATCH/DELETE operace po zopakování operationId v potvrzení. |
| `tta_jobs_list`, `tta_jobs_count` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Vyžaduje pojmenovaný job query vytvořený v TTA. |
| `tta_job_details`, `tta_job_state`, `tta_job_history`, `tta_job_events`, `tta_job_variables` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Swagger REST endpointy pro konkrétní job. Citlivé hodnoty proměnných se redigují podle názvu. |
| `tta_activities_query`, `tta_activities_workqueue`, `tta_activities_count` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | TTA activity query; workqueue dále respektuje oprávnění TTA uživatele. |
| `process.definition.read`, `process.design.read` | READ | `IF_PRESENT_IN_SWAGGER` | Vystaveno jen pokud endpoint definuje Swagger konkrétní instance. |
| `process.start`, `job.write`, `activity.write`, `case.write` | WRITE / DESTRUCTIVE | `IF_PRESENT_IN_SWAGGER` | Volání vyžaduje deklarovanou operaci a potvrzené operationId; TTA dále vynucuje oprávnění. |
| `document.read`, `document.write` | READ / WRITE | `IF_PRESENT_IN_SWAGGER` | JSON a Swagger 2 formData; binární přenos má limit 2 MB. |
| `user.read`, `group.read`, `system.read` | READ | `IF_PRESENT_IN_SWAGGER` | Dostupnost závisí na REST Swaggeru a oprávnění účtu. |
| `form.design.*`, `process.design.*`, `administration.*` | WRITE / ADMIN | `IF_PRESENT_IN_SWAGGER` | Jen REST operace definované konkrétním Swaggerem; SDK služby mimo něj dostupné nejsou. |
| OAuth client credentials, Windows auth | AUTH | `UNSUPPORTED` | REST login heslem a SSO session ID jsou podporované; OAuth token flow a Windows login ne. |

`DYNAMIC_FROM_SWAGGER` znamená, že operace se objeví po načtení OpenAPI definice konkrétního TTA připojení. `IF_PRESENT_IN_SWAGGER` neznamená, že každá instalace danou funkci vystavuje; oprávnění a dostupnost ověřuje TTA účet.
