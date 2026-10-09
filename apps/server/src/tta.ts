import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { Store, ConnectionRow } from "./store.js";
import type { Vault } from "./vault.js";
import type { AppConfig } from "./config.js";

export const connectionInput = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().trim().url().max(2048),
  deploymentType: z.enum(["ON_PREMISE", "CLOUD"]),
  version: z.string().trim().max(100).optional().default(""),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  credentials: z.object({ username: z.string().max(300), secret: z.string().min(1).max(4096) }).optional(),
  clearCredentials: z.boolean().optional().default(false),
});

export type ConnectionInput = z.infer<typeof connectionInput>;

export function normalizeBaseUrl(value: string, allowHttp: boolean): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("Adresa TTA musí používat HTTPS. HTTP lze povolit pouze výslovným nastavením TTA_ALLOW_INSECURE_HTTP.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Adresa nesmí obsahovat uživatelské jméno, heslo, query ani fragment.");
  if (!url.hostname) throw new Error("Adresa TTA musí obsahovat název serveru.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function safeConnection(row: ConnectionRow) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    deploymentType: row.deployment_type,
    version: row.tta_version,
    enabled: Boolean(row.enabled),
    timeoutMs: row.timeout_ms,
    credentialsStored: Boolean(row.credential_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    capabilities: [{ name: "endpoint.reachability", status: "NOT_TESTED" }],
  };
}

export function saveConnection(store: Store, vault: Vault, config: AppConfig, input: ConnectionInput, id?: string): ConnectionRow {
  const baseUrl = normalizeBaseUrl(input.baseUrl, config.allowInsecureTtaHttp);
  const now = new Date().toISOString();
  const current = id ? store.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | undefined : undefined;
  if (id && !current) throw new Error("Připojení nebylo nalezeno.");
  const connectionId = id ?? randomUUID();
  let encryptedCredential = current?.credential_ciphertext ?? null;
  if (input.clearCredentials) encryptedCredential = null;
  if (input.credentials) encryptedCredential = vault.encrypt(JSON.stringify(input.credentials));

  if (current) {
    store.db.prepare(`
      UPDATE connections SET name=?, base_url=?, deployment_type=?, tta_version=?, enabled=?, timeout_ms=?,
        credential_ciphertext=?, updated_at=? WHERE id=?
    `).run(input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs, encryptedCredential, now, connectionId);
  } else {
    store.db.prepare(`
      INSERT INTO connections(id,name,base_url,deployment_type,tta_version,enabled,timeout_ms,credential_ciphertext,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(connectionId, input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs, encryptedCredential, now, now);
  }
  return store.db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId) as ConnectionRow;
}

export interface ProbeResult {
  status: "REACHABLE" | "AUTH_REQUIRED" | "UNREACHABLE";
  httpStatus: number | null;
  durationMs: number;
  detail: string;
}

export async function probeConnection(store: Store, row: ConnectionRow): Promise<ProbeResult> {
  const start = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), row.timeout_ms);
  let result: ProbeResult;
  try {
    const response = await fetch(row.base_url, {
      method: "GET",
      redirect: "manual",
      signal: abort.signal,
      headers: { accept: "text/html, application/json;q=0.8, */*;q=0.2", "user-agent": "TTA-MCP-Server/0.1.2" },
    });
    const durationMs = Date.now() - start;
    if (response.status === 401 || response.status === 403) {
      result = { status: "AUTH_REQUIRED", httpStatus: response.status, durationMs, detail: "Server odpovídá; vyžaduje nebo odmítá autentizaci. API kompatibilita ověřena nebyla." };
    } else {
      result = { status: "REACHABLE", httpStatus: response.status, durationMs, detail: `HTTP server odpověděl stavem ${response.status}. Detekce TTA API ani autentizace nejsou v této verzi ověřeny.` };
    }
    void response.body?.cancel().catch(() => undefined);
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    result = {
      status: "UNREACHABLE",
      httpStatus: null,
      durationMs: Date.now() - start,
      detail: timeout ? "Vypršel časový limit připojení." : "Server není dosažitelný nebo selhalo ověření TLS/DNS.",
    };
  } finally {
    clearTimeout(timer);
  }
  const now = new Date().toISOString();
  store.db.prepare("UPDATE connections SET last_checked_at=?, last_status=?, last_error=? WHERE id=?")
    .run(now, result.status, result.status === "UNREACHABLE" ? result.detail : null, row.id);
  return result;
}
