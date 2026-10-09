import { randomUUID } from "node:crypto";
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
  systemSessionId: z.string().min(1).max(4096),
});
const sdkPathSchema = z.string().trim().min(1).max(512).default("/Services/Sdk");

export const connectionInput = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().trim().url().max(2048),
  deploymentType: z.enum(["ON_PREMISE", "CLOUD"]),
  version: z.string().trim().max(100).optional().default(""),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  sdkPath: sdkPathSchema,
  authMode: z.enum(["PASSWORD", "SYSTEM_SESSION_ID"]).default("PASSWORD"),
  logonProtocol: z.union([z.literal(5), z.literal(7), z.literal(8)]).default(7),
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
  if (url.username || url.password || url.search || url.hash) throw new Error("Adresa nesmí obsahovat uživatelské jméno, heslo, query ani fragment.");
  if (!url.hostname) throw new Error("Adresa TTA musí obsahovat název serveru.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeSdkPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { throw new Error("Cesta SDK obsahuje neplatné kódování."); }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") || decoded.split("/").some((part) => part === "..")) {
    throw new Error("Cesta TTA SDK musí být absolutní cesta bez query, fragmentu nebo segmentu '..'.");
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
    sdkPath: row.sdk_path,
    authMode: row.auth_mode,
    logonProtocol: row.logon_protocol,
    credentialsStored: Boolean(row.credential_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    capabilities: [
      { name: "tta.sdk.json", status: apiStatus },
      { name: "tta.auth.session", status: apiStatus },
    ],
  };
}

export function saveConnection(store: Store, vault: Vault, config: AppConfig, input: ConnectionInput, id?: string): ConnectionRow {
  const baseUrl = normalizeBaseUrl(input.baseUrl, config.allowInsecureTtaHttp);
  const sdkPath = normalizeSdkPath(input.sdkPath);
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
        sdk_path=?, auth_mode=?, logon_protocol=?, credential_ciphertext=?, updated_at=? WHERE id=?
    `).run(input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs,
      sdkPath, input.authMode, input.logonProtocol, encryptedCredential, now, connectionId);
  } else {
    store.db.prepare(`
      INSERT INTO connections(id,name,base_url,deployment_type,tta_version,enabled,timeout_ms,sdk_path,auth_mode,logon_protocol,credential_ciphertext,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(connectionId, input.name, baseUrl, input.deploymentType, input.version || null, Number(input.enabled), input.timeoutMs,
      sdkPath, input.authMode, input.logonProtocol, encryptedCredential, now, now);
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
  authenticatedAs?: string;
}

type JsonObject = Record<string, unknown>;
type TtaCredentials = z.infer<typeof passwordCredentials> | z.infer<typeof systemSessionCredentials>;
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

function unwrapJson(value: unknown): unknown {
  const wrapped = getField(value, "d");
  if (wrapped !== undefined) return wrapped;
  const result = getField(value, "result");
  return result !== undefined ? result : value;
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

function sdkMethodUrl(row: ConnectionRow, service: string, method: string): string {
  const base = new URL(row.base_url);
  const basePath = base.pathname.replace(/\/+$/, "");
  const sdkPath = normalizeSdkPath(row.sdk_path).replace(/^\/+/, "");
  base.pathname = `${basePath}/${sdkPath}/${service}.svc/json/${method}`.replace(/\/{2,}/g, "/");
  base.search = "";
  base.hash = "";
  return base.toString();
}

async function sdkPost<T = unknown>(row: ConnectionRow, service: string, method: string, parameters: JsonObject): Promise<T> {
  const url = sdkMethodUrl(row, service, method);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeout_ms);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json", "content-type": "application/json; charset=utf-8", "user-agent": "TTA-MCP-Server/0.2.0" },
      body: JSON.stringify(parameters),
    });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new TtaSdkError("TTA SDK vrátil přesměrování; zkontrolujte základní URL a cestu SDK.", response.status);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new TtaSdkError("TTA SDK odmítlo autentizaci nebo oprávnění.", response.status, "AUTH_REJECTED");
      if (response.status === 404) throw new TtaSdkError("TTA SDK endpoint nebyl nalezen; zkontrolujte základní URL a cestu SDK.", response.status, "SDK_UNAVAILABLE");
      throw new TtaSdkError(`TTA SDK vrátilo HTTP ${response.status}.`, response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      void response.body?.cancel().catch(() => undefined);
      throw new TtaSdkError("Odpověď není JSON. Zkontrolujte cestu SDK JSON a přihlašovací stránku TTA.", response.status, "SDK_UNAVAILABLE");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new TtaSdkError("Odpověď TTA překročila limit 2 MB.", response.status);
    let parsed: unknown;
    try { parsed = JSON.parse(text) as unknown; }
    catch { throw new TtaSdkError("TTA SDK vrátilo neplatný JSON.", response.status, "SDK_UNAVAILABLE"); }
    const unwrapped = unwrapJson(parsed);
    const errorMessage = getField(unwrapped, "ExceptionMessage", "exceptionMessage");
    const errorType = getField(unwrapped, "ExceptionType", "exceptionType", "errorCode", "ErrorCode");
    if (errorMessage || errorType) {
      const code = typeof errorType === "string" ? errorType.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) : undefined;
      throw new TtaSdkError("TTA SDK požadavek selhal" + (code ? ` (${code})` : "."), response.status, code);
    }
    return unwrapped as T;
  } catch (error) {
    if (error instanceof TtaSdkError) throw error;
    const timeout = error instanceof Error && error.name === "AbortError";
    throw new TtaSdkError(timeout ? "Vypršel časový limit požadavku na TTA SDK." : "TTA SDK není dosažitelné nebo selhalo ověření TLS/DNS.");
  } finally {
    clearTimeout(timer);
  }
}

async function validateTtaSession(row: ConnectionRow, sessionId: string): Promise<boolean> {
  const validation = await sdkPost(row, "UserService", "ValidateSession", { sessionId });
  const validatedId = getField(validation, "SessionId", "sessionId");
  const validFlag = getField(validation, "isValid", "IsValid");
  return typeof validatedId === "string" && validatedId === sessionId && validFlag !== false && validFlag !== "false";
}

async function acquireTtaSession(vault: Vault, row: ConnectionRow): Promise<string> {
  const credentials = readCredentials(vault, row);
  if (!credentials) throw new TtaSdkError("Připojení nemá uložené credentials. Nastavte autentizaci a zkuste test znovu.", null, "AUTH_REQUIRED");
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
      session = await sdkPost(row, "UserService", "GetSingleSignOnSession", {
        systemSessionId: credentials.systemSessionId,
        userIdentity: { UserId: credentials.username, LogOnProtocol: row.logon_protocol },
      });
    } else {
      session = await sdkPost(row, "UserService", "GetSessionWithPassword", {
        userIdentity: { UserId: credentials.username, Password: credentials.secret, LogOnProtocol: row.logon_protocol },
      });
    }
    const sessionId = getField(session, "SessionId", "sessionId");
    const isValid = getField(session, "isValid", "IsValid");
    if (typeof sessionId !== "string" || !sessionId || isValid === false || isValid === "false") {
      throw new TtaSdkError("TTA nepřidělilo platnou relaci. Ověřte uživatele, autentizaci a logon protocol.", null, "AUTH_REJECTED");
    }
    if (!await validateTtaSession(row, sessionId)) {
      throw new TtaSdkError("TTA session nebyla platná.", null, "AUTH_REJECTED");
    }
    if ((sessionGenerations.get(row.id) ?? 0) === generation) sessionCache.set(row.id, sessionId);
    return sessionId;
  })();
  sessionLocks.set(row.id, authentication);
  try {
    return await authentication;
  } finally {
    if (sessionLocks.get(row.id) === authentication) sessionLocks.delete(row.id);
  }
}

export async function withTtaSession<T>(vault: Vault, row: ConnectionRow, run: (sessionId: string) => Promise<T>): Promise<T> {
  return run(await acquireTtaSession(vault, row));
}

const READ_ONLY_SDK_METHODS: Record<string, ReadonlySet<string>> = {
  ProcessService: new Set(["GetProcessesSummary", "GetProcessInfo2", "GetProcessHelpText", "GetProcessStatesSummary"]),
  JobService: new Set(["GetJobState", "GetJobHistory2", "GetJobEvents"]),
  ActivityService: new Set(["GetActivitiesInJobWithStatus"]),
};

export async function callTtaSdk<T = unknown>(vault: Vault, row: ConnectionRow, service: string, method: string, parameters: JsonObject): Promise<T> {
  if (!READ_ONLY_SDK_METHODS[service]?.has(method)) throw new TtaSdkError("Tato TTA SDK operace není v read-only katalogu povolena.");
  return withTtaSession(vault, row, (sessionId) => sdkPost<T>(row, service, method, { ...parameters, sessionId }));
}

export async function probeConnection(store: Store, vault: Vault, row: ConnectionRow): Promise<ProbeResult> {
  const start = Date.now();
  let result: ProbeResult;
  try {
    const credentials = readCredentials(vault, row);
    if (!credentials) {
      result = { status: "AUTH_REQUIRED", httpStatus: null, durationMs: Date.now() - start, detail: "TTA SDK zatím nebylo ověřeno. Zadejte interní uživatelské jméno a heslo nebo SYSTEM_SESSION_ID." };
    } else {
      await withTtaSession(vault, row, async () => undefined);
      result = {
        status: "API_COMPATIBLE",
        httpStatus: 200,
        durationMs: Date.now() - start,
        detail: "Přihlášení TTA i SDK JSON relace byly ověřeny voláním UserService. API je připravené k použití v mezích oprávnění tohoto účtu.",
      };
    }
  } catch (error) {
    const sdkError = error instanceof TtaSdkError ? error : new TtaSdkError("Test TTA SDK selhal.");
    const status: ProbeStatus = sdkError.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED"
      : sdkError.code === "AUTH_REJECTED" || sdkError.httpStatus === 401 || sdkError.httpStatus === 403 ? "AUTH_REJECTED"
        : sdkError.code === "SDK_UNAVAILABLE" || sdkError.httpStatus === 404 ? "SDK_UNAVAILABLE"
          : "UNREACHABLE";
    result = { status, httpStatus: sdkError.httpStatus, durationMs: Date.now() - start, detail: sdkError.message };
  }
  const now = new Date().toISOString();
  store.db.prepare("UPDATE connections SET last_checked_at=?, last_status=?, last_error=? WHERE id=?")
    .run(now, result.status, result.status === "API_COMPATIBLE" ? null : result.detail, row.id);
  return result;
}
