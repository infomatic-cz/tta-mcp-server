import { randomUUID } from "node:crypto";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { z } from "zod/v4";
import type { Store, ConnectionRow } from "./store.js";
import type { Vault } from "./vault.js";
import type { AppConfig } from "./config.js";

const passwordCredentials = z.object({
  username: z.string().trim().min(1).max(300),
  secret: z.string().min(1).max(4096),
});
const systemSessionCredentials = z.object({
  username: z.string().trim().min(1).max(300),
  systemSessionId: z.string().min(1).max(4096).refine((value) => !/[\r\n]/.test(value), "SYSTEM_SESSION_ID obsahuje nepovolené znaky."),
});
const apiPathSchema = z.string().trim().min(1).max(512).default("/services/sdk/v1");

export const connectionInput = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().trim().url().max(2048),
  deploymentType: z.enum(["ON_PREMISE", "CLOUD"]),
  version: z.string().trim().max(100).optional().default(""),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  apiPath: apiPathSchema,
  trustInvalidCertificate: z.boolean().default(false),
  authMode: z.enum(["PASSWORD", "SYSTEM_SESSION_ID"]).default("PASSWORD"),
  credentials: z.union([passwordCredentials, systemSessionCredentials]).optional(),
  clearCredentials: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (value.credentials && value.authMode === "PASSWORD" && !("secret" in value.credentials)) {
    context.addIssue({ code: "custom", path: ["credentials"], message: "Pro interní přihlášení zadejte uživatelské jméno a heslo." });
  }
  if (value.credentials && value.authMode === "SYSTEM_SESSION_ID" && !("systemSessionId" in value.credentials)) {
    context.addIssue({ code: "custom", path: ["credentials"], message: "Pro systémovou relaci zadejte uživatele a SYSTEM_SESSION_ID." });
  }
});

export type ConnectionInput = z.infer<typeof connectionInput>;

export function normalizeBaseUrl(value: string, allowHttp: boolean): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("Adresa TTA musí používat HTTPS. HTTP lze povolit pouze výslovným nastavením TTA_ALLOW_INSECURE_HTTP.");
  }
  if (url.username || url.password || url.search) throw new Error("Adresa nesmí obsahovat uživatelské jméno, heslo ani query.");
  if (!url.hostname) throw new Error("Adresa TTA musí obsahovat název serveru.");

  // Accept the Swagger UI URL pasted from the browser and normalize it to the API root.
  if (/\/swagger\/ui\/index\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/swagger\/ui\/index\/?$/i, "");
    url.hash = "";
  } else if (url.hash) {
    throw new Error("Adresa nesmí obsahovat fragment URL. Vložte kořenovou URL TTA nebo odkaz na její Swagger UI.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeApiPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { throw new Error("Cesta REST API obsahuje neplatné kódování."); }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") || decoded.split("/").some((part) => part === "..")) {
    throw new Error("Cesta REST API musí být absolutní cesta bez query, fragmentu nebo segmentu '..'.");
  }
  return path.replace(/\/+$/, "") || "/";
}

export function safeConnection(row: ConnectionRow) {
  const apiStatus = row.last_status === "API_COMPATIBLE" ? "SUPPORTED"
    : row.last_status === "AUTH_REJECTED" ? "NOT_AUTHORIZED"
      : row.last_status === "SDK_UNAVAILABLE" ? "UNSUPPORTED" : "NOT_TESTED";
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    deploymentType: row.deployment_type,
    version: row.tta_version,
    enabled: Boolean(row.enabled),
    timeoutMs: row.timeout_ms,
    apiPath: row.sdk_path,
    trustInvalidCertificate: Boolean(row.trust_invalid_certificate),
    authMode: row.auth_mode,
    credentialsStored: Boolean(row.credential_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    capabilities: [
      { name: "tta.rest.v1", status: apiStatus },
      { name: "tta.auth.session", status: apiStatus },
    ],
  };
}

export function saveConnection(store: Store, vault: Vault, config: AppConfig, input: ConnectionInput, id?: string): ConnectionRow {
  const baseUrl = normalizeBaseUrl(input.baseUrl, config.allowInsecureTtaHttp);
  const apiPath = normalizeApiPath(input.apiPath);
  const now = new Date().toISOString();
  const current = id ? store.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | undefined : undefined;
  if (id && !current) throw new Error("Připojení nebylo nalezeno.");
  const connectionId = id ?? randomUUID();
  let encryptedCredential = current?.credential_ciphertext ?? null;
  if (input.clearCredentials) encryptedCredential = null;
  if (input.credentials) {
    const valid = input.authMode === "PASSWORD" ? passwordCredentials.safeParse(input.credentials) : systemSessionCredentials.safeParse(input.credentials);
    if (!valid.success) throw new Error(input.authMode === "PASSWORD" ? "Zadejte jméno a heslo TTA." : "Zadejte jméno a SYSTEM_SESSION_ID TTA.");
    encryptedCredential = vault.encrypt(JSON.stringify(valid.data));
  } else if (current?.credential_ciphertext && !input.clearCredentials && current.auth_mode !== input.authMode) {
    throw new Error("Při změně způsobu autentizace zadejte nové tajné údaje.");
  }

  if (current) {
    store.db.prepare(`
      UPDATE connections SET name=?, base_url=?, deployment_type=?, tta_version=?, enabled=?, timeout_ms=?,
        sdk_path=?, trust_invalid_certificate=?, auth_mode=?, credential_ciphertext=?, updated_at=? WHERE id=?
    `).run(input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs,
      apiPath, Number(input.trustInvalidCertificate), input.authMode, encryptedCredential, now, connectionId);
  } else {
    store.db.prepare(`
      INSERT INTO connections(id,name,base_url,deployment_type,tta_version,enabled,timeout_ms,sdk_path,trust_invalid_certificate,auth_mode,logon_protocol,credential_ciphertext,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,7,?,?,?)
    `).run(connectionId, input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs,
      apiPath, Number(input.trustInvalidCertificate), input.authMode, encryptedCredential, now, now);
  }
  invalidateTtaSession(connectionId);
  return store.db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId) as ConnectionRow;
}

export type ProbeStatus = "API_COMPATIBLE" | "AUTH_REQUIRED" | "AUTH_REJECTED" | "SDK_UNAVAILABLE" | "UNREACHABLE";
export interface ProbeResult {
  status: ProbeStatus;
  httpStatus: number | null;
  durationMs: number;
  detail: string;
}

type JsonObject = Record<string, unknown>;
type TtaCredentials = z.infer<typeof passwordCredentials> | z.infer<typeof systemSessionCredentials>;
type RestMethod = "GET" | "POST";
type QueryValue = string | number | boolean | undefined;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const unverifiedTlsAgent = new HttpsAgent({ keepAlive: true, rejectUnauthorized: false });
const sessionCache = new Map<string, string>();
const sessionLocks = new Map<string, Promise<string>>();
const sessionGenerations = new Map<string, number>();

export function invalidateTtaSession(connectionId: string): void {
  sessionCache.delete(connectionId);
  sessionLocks.delete(connectionId);
  sessionGenerations.set(connectionId, (sessionGenerations.get(connectionId) ?? 0) + 1);
}

export class TtaSdkError extends Error {
  constructor(message: string, readonly httpStatus: number | null = null, readonly code?: string) {
    super(message);
    this.name = "TtaSdkError";
  }
}

function getField(source: unknown, ...names: string[]): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const record = source as JsonObject;
  for (const name of names) {
    if (name in record) return record[name];
    const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) return record[match];
  }
  return undefined;
}

function readCredentials(vault: Vault, row: ConnectionRow): TtaCredentials | null {
  if (!row.credential_ciphertext) return null;
  try {
    const parsed: unknown = JSON.parse(vault.decrypt(row.credential_ciphertext));
    if (row.auth_mode === "SYSTEM_SESSION_ID") return systemSessionCredentials.parse(parsed);
    if (parsed && typeof parsed === "object" && "systemSessionId" in parsed) return systemSessionCredentials.parse(parsed);
    return passwordCredentials.parse(parsed);
  } catch {
    throw new TtaSdkError("Uložené přihlašovací údaje nelze dešifrovat. Zadejte je znovu.");
  }
}

function restUrl(row: ConnectionRow, route: string, query: Record<string, QueryValue> = {}): URL {
  const url = new URL(row.base_url);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiPath = normalizeApiPath(row.sdk_path).replace(/\/+$/, "");
  url.pathname = `${basePath}${apiPath}/${route.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readLimitedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new TtaSdkError("Odpověď TTA překročila limit 2 MB.", response.status);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new TtaSdkError("Odpověď TTA překročila limit 2 MB.", response.status);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function requestWithUnverifiedTls(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = httpsRequest(url, {
      method: init.method,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(typeof init.body === "string" ? { "content-length": String(Buffer.byteLength(init.body)) } : {}),
      },
      signal: init.signal ?? undefined,
      agent: unverifiedTlsAgent,
    }, (incoming) => {
      const status = incoming.statusCode ?? 502;
      const contentLength = Number(incoming.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        incoming.destroy();
        fail(new TtaSdkError("Odpověď TTA překročila limit 2 MB.", status));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on("data", (chunk: Buffer | Uint8Array) => {
        total += chunk.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          incoming.destroy();
          fail(new TtaSdkError("Odpověď TTA překročila limit 2 MB.", status));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.once("error", fail);
      incoming.once("end", () => {
        if (settled) return;
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const body = Buffer.concat(chunks);
        const responseBody = [204, 205, 304].includes(status) || body.length === 0 ? null : body;
        try {
          const response = new Response(responseBody, { status, headers });
          settled = true;
          resolve(response);
        } catch (error) {
          fail(error instanceof Error ? error : new Error("TTA REST API vrátilo neplatnou HTTP odpověď."));
        }
      });
    });
    request.once("error", fail);
    if (typeof init.body === "string") request.write(init.body);
    request.end();
  });
}

function networkErrorDetail(error: unknown, allowUnverifiedCertificate: boolean): string {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const record = current as { code?: unknown; cause?: unknown };
      const code = typeof record.code === "string" ? record.code : "";
      if (/^(CERT_|ERR_TLS_CERT_|ERR_SSL_CERTIFICATE_VERIFY_FAILED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code)) {
        return allowUnverifiedCertificate
          ? `TLS handshake s TTA selhal i s vypnutou kontrolou důvěryhodnosti certifikátu (${code}). Zkontrolujte podporované TLS protokoly a certifikát serveru.`
          : `Ověření TLS certifikátu TTA selhalo (${code}). Nainstalujte interní CA do systémového úložiště, nebo pro toto připojení výslovně zapněte „Důvěřovat certifikátu TTA“.`;
      }
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Název TTA serveru se nepodařilo přeložit (${code}). Zkontrolujte DNS.`;
      if (code === "ECONNREFUSED") return "TTA server odmítl síťové spojení. Zkontrolujte hostitele, port a firewall.";
      current = record.cause;
    } else {
      break;
    }
  }
  return "TTA REST API není dosažitelné. Zkontrolujte DNS, síťovou trasu, port a TLS certifikát.";
}

async function restRequest<T = unknown>(row: ConnectionRow, method: RestMethod, route: string,
  options: { query?: Record<string, QueryValue>; body?: JsonObject; authorization?: string; authentication?: boolean } = {}): Promise<T> {
  const url = restUrl(row, route, options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeout_ms);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "TTA-MCP-Server/0.2.4",
  };
  if (options.authorization) headers.authorization = options.authorization;
  if (options.body) headers["content-type"] = "application/json; charset=utf-8";
  try {
    const init: RequestInit = {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    };
    const response = row.trust_invalid_certificate && url.protocol === "https:"
      ? await requestWithUnverifiedTls(url, init)
      : await fetch(url, init);
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new TtaSdkError("TTA REST API vrátilo přesměrování; zkontrolujte základní URL a cestu REST API.", response.status);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403 || (options.authentication && response.status === 400)) {
        throw new TtaSdkError("TTA REST API odmítlo přihlášení nebo oprávnění.", response.status, "AUTH_REJECTED");
      }
      if (response.status === 404) throw new TtaSdkError("TTA REST API endpoint nebyl nalezen; zkontrolujte URL a cestu API.", response.status, "SDK_UNAVAILABLE");
      throw new TtaSdkError(`TTA REST API vrátilo HTTP ${response.status}.`, response.status);
    }
    if (response.status === 204) return null as T;
    const contentType = response.headers.get("content-type") ?? "";
    const text = await readLimitedBody(response);
    if (!text) return null as T;
    if (!contentType.toLowerCase().includes("json")) throw new TtaSdkError("TTA REST API nevrátilo JSON. Zkontrolujte URL API a autentizaci.", response.status, "SDK_UNAVAILABLE");
    try { return JSON.parse(text) as T; }
    catch { throw new TtaSdkError("TTA REST API vrátilo neplatný JSON.", response.status, "SDK_UNAVAILABLE"); }
  } catch (error) {
    if (error instanceof TtaSdkError) throw error;
    const timeout = error instanceof Error && error.name === "AbortError";
    throw new TtaSdkError(timeout ? "Vypršel časový limit požadavku na TTA REST API." : networkErrorDetail(error, Boolean(row.trust_invalid_certificate)));
  } finally {
    clearTimeout(timer);
  }
}

async function validateTtaSession(row: ConnectionRow, sessionId: string): Promise<boolean> {
  const validation = await restRequest(row, "POST", `users/sessions/${encodeURIComponent(sessionId)}/validate`);
  return getField(validation, "IsValid", "isValid") === true;
}

async function acquireTtaSession(vault: Vault, row: ConnectionRow): Promise<string> {
  const credentials = readCredentials(vault, row);
  if (!credentials) throw new TtaSdkError("Připojení nemá uložené údaje. Nastavte autentizaci a zkuste test znovu.", null, "AUTH_REQUIRED");
  const generation = sessionGenerations.get(row.id) ?? 0;

  const cached = sessionCache.get(row.id);
  if (cached) {
    try {
      if (await validateTtaSession(row, cached)) return cached;
      sessionCache.delete(row.id);
    } catch (error) {
      if (!(error instanceof TtaSdkError) || error.code !== "AUTH_REJECTED") throw error;
      sessionCache.delete(row.id);
    }
  }

  const inflight = sessionLocks.get(row.id);
  if (inflight) return inflight;
  const authentication = (async () => {
    let session: unknown;
    if ("systemSessionId" in credentials) {
      session = await restRequest(row, "POST", "users/sessions/single-sign-on", {
        authorization: credentials.systemSessionId,
        body: { UserId: credentials.username },
        authentication: true,
      });
    } else {
      session = await restRequest(row, "POST", "users/sessions", {
        body: { UserName: credentials.username, Password: credentials.secret, UnconditionalLogOn: false },
        authentication: true,
      });
    }
    const sessionId = getField(session, "SessionId", "sessionId");
    const loginState = getField(session, "LogOnStateType", "logOnStateType");
    if (typeof sessionId !== "string" || !sessionId || (loginState !== undefined && Number(loginState) !== 0)) {
      throw new TtaSdkError("TTA nevrátilo přihlášenou relaci. Ověřte interní účet, heslo nebo SYSTEM_SESSION_ID.", null, "AUTH_REJECTED");
    }
    if (!await validateTtaSession(row, sessionId)) {
      throw new TtaSdkError("TTA relace není platná.", null, "AUTH_REJECTED");
    }
    if ((sessionGenerations.get(row.id) ?? 0) === generation) sessionCache.set(row.id, sessionId);
    return sessionId;
  })();
  sessionLocks.set(row.id, authentication);
  try { return await authentication; }
  finally { if (sessionLocks.get(row.id) === authentication) sessionLocks.delete(row.id); }
}

export async function withTtaSession<T>(vault: Vault, row: ConnectionRow, run: (sessionId: string) => Promise<T>): Promise<T> {
  return run(await acquireTtaSession(vault, row));
}

function requiredString(parameters: JsonObject, name: string): string {
  const value = parameters[name];
  if (typeof value !== "string" || !value || value.includes("/") || value.includes("\\")) throw new TtaSdkError(`Neplatný parametr ${name}.`);
  return value;
}

export async function callTtaApi<T = unknown>(vault: Vault, row: ConnectionRow, operation: string, parameters: JsonObject): Promise<T> {
  return withTtaSession(vault, row, async (sessionId) => {
    const authorization = sessionId;
    switch (operation) {
      case "jobs.list":
        return restRequest<T>(row, "GET", "jobs", { query: { queryName: requiredString(parameters, "queryName") }, authorization });
      case "jobs.count":
        return restRequest<T>(row, "GET", "jobs/count", { query: { queryName: requiredString(parameters, "queryName") }, authorization });
      case "job.details":
        return restRequest<T>(row, "GET", `jobs/${encodeURIComponent(requiredString(parameters, "jobId"))}`, {
          query: { associatedJobsHistory: parameters.associatedJobsHistory === true }, authorization,
        });
      case "job.state":
        return restRequest<T>(row, "GET", `jobs/${encodeURIComponent(requiredString(parameters, "jobId"))}/state`, { authorization });
      case "job.history":
        return restRequest<T>(row, "GET", `jobs/${encodeURIComponent(requiredString(parameters, "jobId"))}/history`, {
          query: { associatedJobsHistory: parameters.associatedJobsHistory === true }, authorization,
        });
      case "job.variables":
        return restRequest<T>(row, "GET", `jobs/${encodeURIComponent(requiredString(parameters, "jobId"))}/variables`, { authorization });
      case "job.events": {
        const details = await restRequest<unknown>(row, "GET", `jobs/${encodeURIComponent(requiredString(parameters, "jobId"))}`, { authorization });
        return (getField(details, "Events", "events") ?? []) as T;
      }
      case "activities.query":
        return restRequest<T>(row, "GET", `activities/${encodeURIComponent(requiredString(parameters, "queryName"))}`, { authorization });
      case "activities.workqueue":
        return restRequest<T>(row, "GET", "activities/workqueue", {
          query: { queryName: requiredString(parameters, "queryName") }, authorization,
        });
      case "activities.count":
        return restRequest<T>(row, "GET", "activities/count", {
          query: {
            queryName: typeof parameters.queryName === "string" ? parameters.queryName : undefined,
            jobId: typeof parameters.jobId === "string" ? parameters.jobId : undefined,
            activityStatus: typeof parameters.activityStatus === "number" ? parameters.activityStatus : undefined,
          }, authorization,
        });
      default:
        throw new TtaSdkError("Tato operace není povolena v read-only katalogu.");
    }
  });
}

export async function probeConnection(store: Store, vault: Vault, row: ConnectionRow): Promise<ProbeResult> {
  const start = Date.now();
  let result: ProbeResult;
  try {
    const credentials = readCredentials(vault, row);
    if (!credentials) {
      result = { status: "AUTH_REQUIRED", httpStatus: null, durationMs: Date.now() - start, detail: "TTA REST API zatím nebylo ověřeno. Zadejte interní uživatelské jméno a heslo nebo SYSTEM_SESSION_ID." };
    } else {
      await withTtaSession(vault, row, async () => undefined);
      result = {
        status: "API_COMPATIBLE",
        httpStatus: 200,
        durationMs: Date.now() - start,
        detail: "Přihlášení přes TTA REST API a platnost relace byly ověřeny. Dostupnost jednotlivých operací závisí na oprávněních účtu.",
      };
    }
  } catch (error) {
    const apiError = error instanceof TtaSdkError ? error : new TtaSdkError("Test TTA REST API selhal.");
    const status: ProbeStatus = apiError.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED"
      : apiError.code === "AUTH_REJECTED" || apiError.httpStatus === 401 || apiError.httpStatus === 403 ? "AUTH_REJECTED"
        : apiError.code === "SDK_UNAVAILABLE" || apiError.httpStatus === 404 ? "SDK_UNAVAILABLE"
          : "UNREACHABLE";
    result = { status, httpStatus: apiError.httpStatus, durationMs: Date.now() - start, detail: apiError.message };
  }
  const now = new Date().toISOString();
  store.db.prepare("UPDATE connections SET last_checked_at=?, last_status=?, last_error=? WHERE id=?")
    .run(now, result.status, result.status === "API_COMPATIBLE" ? null : result.detail, row.id);
  return result;
}
