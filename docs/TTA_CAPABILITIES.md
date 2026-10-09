# Capability registry

Schopnosti se neodvozují pouze z čísla verze. Test připojení ověřuje REST autentizaci a relaci. Úspěšný login nezaručuje oprávnění ke každému jobu nebo activity query; ty vynucuje TTA účet.

| Capability / MCP nástroj | Riziko | Stav | Poznámka |
|---|---|---|---|
| `tta.rest.v1`, `tta.auth.session` | READ | Po testu `SUPPORTED` | Kontrakty ověřené podle OpenAPI Swaggeru konkrétní instance; autentizace nebyla proti tenantovi spuštěna. |
| `tta_connections_list`, `tta_connection_test` | READ | `AVAILABLE` | MCP token musí mít přiřazené TTA prostředí. |
| `tta_jobs_list`, `tta_jobs_count` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Vyžaduje pojmenovaný job query vytvořený v TTA. |
| `tta_job_details`, `tta_job_state`, `tta_job_history`, `tta_job_events`, `tta_job_variables` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | Swagger REST endpointy pro konkrétní job. Citlivé hodnoty proměnných se redigují podle názvu. |
| `tta_activities_query`, `tta_activities_workqueue`, `tta_activities_count` | READ | `IMPLEMENTED_NOT_TENANT_VERIFIED` | TTA activity query; workqueue dále respektuje oprávnění TTA uživatele. |
| `process.definition.read`, `process.design.read` | READ | `UNSUPPORTED` | Dodaný Swagger neobsahuje odpovídající procesní endpointy. |
| `process.start`, `job.write`, `activity.write`, `case.write` | WRITE / DESTRUCTIVE | `UNSUPPORTED` | Existující REST write routy nejsou v MCP vystavené. |
| `document.read`, `document.write` | READ / WRITE | `UNSUPPORTED` | Binární obsah dokumentů se nepřenáší. |
| `user.read`, `group.read`, `system.read` | READ | `UNSUPPORTED` | Zatím nejsou MCP nástroje pro administraci TTA. |
| `form.design.*`, `process.design.*`, `administration.*` | WRITE / ADMIN | `UNSUPPORTED` | Designer a administrativní operace nejsou vystavené. |
| OAuth client credentials, Windows auth | AUTH | `UNSUPPORTED` | REST login heslem a SSO session ID jsou podporované; OAuth token flow a Windows login ne. |

`IMPLEMENTED_NOT_TENANT_VERIFIED` znamená, že MCP volá endpoint a model doložený skutečným Swaggerem, ale přihlášení a oprávnění na cílovém tenantovi ještě nebyly ověřeny.
