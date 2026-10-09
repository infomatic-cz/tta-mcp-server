# Capability registry

V 0.1.2 se capabilities nikdy neodvozují pouze z čísla verze. Aktuálně:

| Capability | Stav | Poznámka |
|---|---|---|
| `endpoint.reachability` | `NOT_TESTED` do prvního HTTP testu | Obecná dosažitelnost URL, nikoliv schopnost TTA API. |
| `tta.api.discovery` | `UNKNOWN` | Instalace API dokumentaci zveřejňují různě; automatický probe není implementován. |
| `process.read`, `process.start` | `UNSUPPORTED` v MCP serveru 0.1.2 | Adapter a doložený kontrakt chybí. |
| `job.read`, `job.suspend`, `job.resume`, `job.terminate` | `UNSUPPORTED` v MCP serveru 0.1.2 | Nepovoleno. |
| `activity.read`, `activity.complete` | `UNSUPPORTED` v MCP serveru 0.1.2 | Nepovoleno. |
| `document.read`, `document.write` | `UNSUPPORTED` v MCP serveru 0.1.2 | Nepovoleno. |
| `user.read`, `system.read` | `UNSUPPORTED` v MCP serveru 0.1.2 | Nepovoleno. |

`UNSUPPORTED` popisuje aktuální MCP server. `UNKNOWN` znamená, že vlastnost instalace nebyla zjištěna. Po přidání adaptéru musí capability obsahovat konkrétní dokumentační zdroj, verzi, způsob autentizace, diagnostiku a čas ověření.
