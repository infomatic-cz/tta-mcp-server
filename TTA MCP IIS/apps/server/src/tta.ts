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
type RestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type QueryValue = string | number | boolean | undefined;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Do not reuse sockets for the opt-in unverified-certificate path. IIS/proxies
// commonly close idle upstream sockets without a reliable keep-alive signal.
const unverifiedTlsAgent = new HttpsAgent({ keepAlive: false, rejectUnauthorized: false });
const sessionCache = new Map<string, string>();
const sessionLocks = new Map<string, Promise<string>>();
const sessionGenerations = new Map<string, number>();

type SwaggerParameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  collectionFormat?: string;
  schema?: JsonObject;
};

type SwaggerOperation = {
  operationId: string;
  method: RestMethod;
  path: string;
  summary?: string;
  description?: string;
  consumes?: string[];
  produces?: string[];
  parameters: SwaggerParameter[];
  raw: JsonObject;
};

type SwaggerDocument = {
  swagger?: string;
  openapi?: string;
  basePath?: string;
  paths: Record<string, Record<string, unknown>>;
  definitions?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
  consumes?: string[];
  produces?: string[];
};

const swaggerCache = new Map<string, { updatedAt: string; expiresAt: number; document: SwaggerDocument; operations: SwaggerOperation[] }>();
const swaggerMethods = new Set<RestMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function invalidateTtaSession(connectionId: string): void {
  sessionCache.delete(connectionId);
  sessionLocks.delete(connectionId);
  swaggerCache.delete(connectionId);
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

async function readLimitedBody(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new TtaSdkError("Odpověď TTA překročila limit 2 MB.", response.status);
  }
  if (!response.body) return Buffer.alloc(0);
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
  return Buffer.from(bytes);
}

function requestWithUnverifiedTls(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const requestBody = typeof init.body === "string" ? init.body
      : init.body instanceof Uint8Array ? Buffer.from(init.body)
        : undefined;
    const request = httpsRequest(url, {
      method: init.method,
      headers: {
        ...(init.headers as Record<string, string>),
        connection: "close",
        ...(requestBody !== undefined ? { "content-length": String(Buffer.byteLength(requestBody)) } : {}),
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
    if (requestBody !== undefined) request.write(requestBody);
    request.end();
  });
}

function networkErrorDetail(error: unknown, allowUnverifiedCertificate: boolean, requestLabel?: string): string {
  const phase = requestLabel ? ` během ${requestLabel}` : "";
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const record = current as { code?: unknown; cause?: unknown };
      const code = typeof record.code === "string" ? record.code : "";
      if (/^(CERT_|ERR_TLS_CERT_|ERR_SSL_CERTIFICATE_VERIFY_FAILED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code)) {
        return allowUnverifiedCertificate
          ? `TLS handshake s TTA selhal${phase} i s vypnutou kontrolou důvěryhodnosti certifikátu (${code}). Zkontrolujte podporované TLS protokoly a certifikát serveru.`
          : `Ověření TLS certifikátu TTA selhalo${phase} (${code}). Nainstalujte interní CA do systémového úložiště, nebo pro toto připojení výslovně zapněte „Důvěřovat certifikátu TTA“.`;
      }
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Název TTA serveru se nepodařilo přeložit${phase} (${code}). Zkontrolujte DNS.`;
      if (code === "ECONNREFUSED") return `TTA server odmítl síťové spojení${phase}. Zkontrolujte hostitele, port a firewall.`;
      if (code === "ECONNRESET") return `TTA server nebo síťový prostředník resetoval spojení${phase} ještě před HTTP odpovědí (ECONNRESET). Volba důvěry certifikátu pouze přeskočí kontrolu certifikátu; reset spojení neodstraní. Zkontrolujte cílový endpoint, protokol TLS a log IIS/reverse proxy/WAF.`;
      if (["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"].includes(code)) return `Síťové spojení k TTA selhalo${phase} před HTTP odpovědí (${code}). Zkontrolujte trasu, firewall a port.`;
      if (/^(ERR_SSL_|ERR_TLS_)/.test(code)) return allowUnverifiedCertificate
        ? `TLS handshake s TTA selhal${phase} (${code}) i s vypnutou kontrolou certifikátu; zkontrolujte TLS protokoly, šifry a případný požadavek na klientský certifikát.`
        : `TLS handshake s TTA selhal${phase} (${code}); zkontrolujte TLS protokoly, šifry a případný požadavek na klientský certifikát. Pokud je problém jen v interní CA, nainstalujte její kořenový certifikát do důvěryhodného úložiště.`;
      if (code) return `Spojení s TTA selhalo${phase} před HTTP odpovědí (${code}). Zkontrolujte síťovou trasu a konfiguraci REST API.`;
      current = record.cause;
    } else {
      break;
    }
  }
  return "TTA REST API není dosažitelné. Zkontrolujte DNS, síťovou trasu, port a TLS certifikát.";
}

async function restRequest<T = unknown>(row: ConnectionRow, method: RestMethod, route: string,
  options: { query?: Record<string, QueryValue>; body?: unknown; contentType?: string; headers?: Record<string, string>; allowBinaryResponse?: boolean; authorization?: string; authentication?: boolean; requestUrl?: URL; requestLabel?: string } = {}): Promise<T> {
  const url = options.requestUrl ?? restUrl(row, route, options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeout_ms);
  const encodedBody = options.body === undefined ? undefined
    : typeof options.body === "string" || options.body instanceof Uint8Array ? options.body
      : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "TTA-MCP-Server/0.3.5",
    ...options.headers,
  };
  if (options.authorization) headers.authorization = options.authorization;
  if (encodedBody !== undefined) headers["content-type"] = options.contentType ?? "application/json; charset=utf-8";
  try {
    const init: RequestInit = {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers,
      ...(encodedBody !== undefined ? { body: encodedBody as unknown as BodyInit } : {}),
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
    const bytes = await readLimitedBody(response);
    if (bytes.length === 0) return null as T;
    if (!contentType.toLowerCase().includes("json")) {
      if (!options.allowBinaryResponse) throw new TtaSdkError("TTA REST API nevrátilo JSON. Zkontrolujte URL API a autentizaci.", response.status, "SDK_UNAVAILABLE");
      return { contentType: contentType || "application/octet-stream", sizeBytes: bytes.length, dataBase64: bytes.toString("base64") } as T;
    }
    try { return JSON.parse(bytes.toString("utf8")) as T; }
    catch { throw new TtaSdkError("TTA REST API vrátilo neplatný JSON.", response.status, "SDK_UNAVAILABLE"); }
  } catch (error) {
    if (error instanceof TtaSdkError) throw error;
    const timeout = error instanceof Error && error.name === "AbortError";
    const phase = options.requestLabel ? ` během ${options.requestLabel}` : "";
    throw new TtaSdkError(timeout ? `Vypršel časový limit požadavku na TTA REST API${phase}.` : networkErrorDetail(error, Boolean(row.trust_invalid_certificate), options.requestLabel));
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mergeSwaggerParameters(...groups: unknown[]): SwaggerParameter[] {
  const merged = new Map<string, SwaggerParameter>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const parameter = asRecord(item);
      if (typeof parameter?.name !== "string" || typeof parameter.in !== "string") continue;
      const key = `${parameter.in}:${parameter.name}`;
      merged.set(key, parameter as unknown as SwaggerParameter);
    }
  }
  return [...merged.values()];
}

function parseSwaggerDocument(value: unknown): { document: SwaggerDocument; operations: SwaggerOperation[] } {
  const root = asRecord(value);
  const paths = asRecord(root?.paths);
  if (!root || !paths || !(typeof root.swagger === "string" || typeof root.openapi === "string")) {
    throw new TtaSdkError("TTA Swagger `/swagger/docs/v1` neobsahuje platnou OpenAPI definici.", null, "SDK_UNAVAILABLE");
  }
  const document = root as unknown as SwaggerDocument;
  const operations: SwaggerOperation[] = [];
  for (const [path, rawPathItem] of Object.entries(paths)) {
    if (!path.startsWith("/") || path.includes("\\") || path.split("/").some((segment) => segment === "..")) continue;
    const pathItem = asRecord(rawPathItem);
    if (!pathItem) continue;
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      const method = rawMethod.toUpperCase() as RestMethod;
      if (!swaggerMethods.has(method)) continue;
      const operation = asRecord(rawOperation);
      if (!operation) continue;
      const operationId = typeof operation.operationId === "string" && operation.operationId.trim()
        ? operation.operationId.trim()
        : `${method} ${path}`;
      operations.push({
        operationId,
        method,
        path,
        ...(typeof operation.summary === "string" ? { summary: operation.summary } : {}),
        ...(typeof operation.description === "string" ? { description: operation.description } : {}),
        ...(Array.isArray(operation.consumes) ? { consumes: operation.consumes.filter((item): item is string => typeof item === "string") } : {}),
        ...(Array.isArray(operation.produces) ? { produces: operation.produces.filter((item): item is string => typeof item === "string") } : {}),
        parameters: mergeSwaggerParameters(pathItem.parameters, operation.parameters),
        raw: operation,
      });
    }
  }
  if (operations.length === 0) throw new TtaSdkError("TTA Swagger neobsahuje podporované GET/POST/PUT/PATCH/DELETE operace.", null, "SDK_UNAVAILABLE");
  return { document, operations };
}

function swaggerUrl(row: ConnectionRow): URL {
  const url = new URL(row.base_url);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/swagger/docs/v1`;
  url.search = "";
  url.hash = "";
  return url;
}

export async function getTtaSwaggerOperations(row: ConnectionRow, sessionId: string): Promise<SwaggerOperation[]> {
  const cached = swaggerCache.get(row.id);
  if (cached && cached.updatedAt === row.updated_at && cached.expiresAt > Date.now()) return cached.operations;
  const document = await restRequest<unknown>(row, "GET", "", {
    requestUrl: swaggerUrl(row),
    authorization: sessionId,
    requestLabel: "načtení REST Swaggeru (GET /swagger/docs/v1)",
  });
  const parsed = parseSwaggerDocument(document);
  swaggerCache.set(row.id, { updatedAt: row.updated_at, expiresAt: Date.now() + 5 * 60 * 1000, ...parsed });
  return parsed.operations;
}

function swaggerParameterSummary(parameter: SwaggerParameter) {
  const schema = parameter.schema;
  const type = parameter.type ?? (typeof schema?.type === "string" ? schema.type : undefined)
    ?? (typeof schema?.$ref === "string" ? schema.$ref : undefined);
  return {
    name: parameter.name,
    in: parameter.in,
    required: Boolean(parameter.required),
    ...(type ? { type } : {}),
    ...(parameter.format ? { format: parameter.format } : {}),
    ...(parameter.description ? { description: parameter.description } : {}),
    ...(Array.isArray(parameter.enum) ? { enum: parameter.enum } : {}),
  };
}

export function describeTtaSwaggerOperation(operation: SwaggerOperation) {
  const responses = asRecord(operation.raw.responses) ?? {};
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    ...(operation.summary ? { summary: operation.summary } : {}),
    ...(operation.description ? { description: operation.description.slice(0, 1000) } : {}),
    parameters: operation.parameters.map(swaggerParameterSummary),
    ...(Array.isArray(operation.raw.consumes) ? { consumes: operation.raw.consumes } : {}),
    ...(Array.isArray(operation.raw.produces) ? { produces: operation.raw.produces } : {}),
    responses: Object.fromEntries(Object.entries(responses).slice(0, 12).map(([status, raw]) => {
      const response = asRecord(raw) ?? {};
      const schema = asRecord(response.schema);
      return [status, {
        ...(typeof response.description === "string" ? { description: response.description.slice(0, 300) } : {}),
        ...(typeof schema?.$ref === "string" ? { schema: schema.$ref } : typeof schema?.type === "string" ? { schema: schema.type } : {}),
      }];
    })),
    ...(asRecord(operation.raw.requestBody) ? { requestBody: {
      required: Boolean(asRecord(operation.raw.requestBody)?.required),
      contentTypes: Object.keys(asRecord(asRecord(operation.raw.requestBody)?.content) ?? {}),
    } } : {}),
    ...(operation.parameters.find((parameter) => parameter.in === "body")?.schema
      ? { bodySchema: operation.parameters.find((parameter) => parameter.in === "body")?.schema }
      : {}),
  };
}

function swaggerOperation(operations: SwaggerOperation[], operationId: string): SwaggerOperation {
  const matches = operations.filter((operation) => operation.operationId === operationId);
  if (matches.length !== 1) throw new TtaSdkError(matches.length ? "TTA Swagger obsahuje nejednoznačný operationId." : "OperationId není v Swaggeru tohoto připojení.", null, "SDK_UNAVAILABLE");
  return matches[0]!;
}

function parameterValue(value: unknown, parameter: SwaggerParameter): string {
  const formatScalar = (item: unknown): string => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
    throw new TtaSdkError(`Parametr ${parameter.name} musí být text, číslo nebo boolean.`);
  };
  if (Array.isArray(value)) {
    const separator = parameter.collectionFormat === "ssv" ? " "
      : parameter.collectionFormat === "tsv" ? "\t"
        : parameter.collectionFormat === "pipes" ? "|" : ",";
    return value.map(formatScalar).join(separator);
  }
  return formatScalar(value);
}

function validateInputParameters(parameters: SwaggerParameter[], supplied: Record<string, unknown>, location: string): Record<string, string> {
  const declarations = parameters.filter((parameter) => parameter.in === location);
  const allowed = new Set(declarations.map((parameter) => parameter.name));
  for (const key of Object.keys(supplied)) if (!allowed.has(key)) throw new TtaSdkError(`Parametr ${key} není v TTA Swaggeru deklarován jako ${location}.`);
  const values: Record<string, string> = {};
  for (const parameter of declarations) {
    const value = supplied[parameter.name];
    if (value === undefined || value === null) {
      if (parameter.required) throw new TtaSdkError(`Chybí povinný parametr ${parameter.name} (${location}).`);
      continue;
    }
    const formatted = parameterValue(value, parameter);
    if (/[\r\n]/.test(formatted)) throw new TtaSdkError(`Parametr ${parameter.name} obsahuje nepovolený nový řádek.`);
    if (Array.isArray(parameter.enum) && !parameter.enum.some((item) => String(item) === formatted)) throw new TtaSdkError(`Parametr ${parameter.name} nemá povolenou hodnotu podle TTA Swaggeru.`);
    values[parameter.name] = formatted;
  }
  return values;
}

function resolvedBodySchema(schema: unknown, document: SwaggerDocument, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  const record = asRecord(schema);
  if (!record) return null;
  if (typeof record.$ref === "string") {
    const parts = record.$ref.split("/");
    const name = parts[parts.length - 1];
    const resolved = name ? document.definitions?.[name] ?? document.components?.schemas?.[name] : undefined;
    return resolvedBodySchema(resolved, document, depth + 1);
  }
  return record;
}

function validateBodySchema(value: unknown, schemaValue: unknown, document: SwaggerDocument, label = "body", depth = 0): void {
  if (depth > 12) return;
  const schema = resolvedBodySchema(schemaValue, document, depth);
  if (!schema) return;
  const type = typeof schema.type === "string" ? schema.type : "object";
  const valid = type === "object" ? Boolean(asRecord(value))
    : type === "array" ? Array.isArray(value)
      : type === "string" ? typeof value === "string"
        : type === "integer" ? Number.isInteger(value)
          : type === "number" ? typeof value === "number" && Number.isFinite(value)
            : type === "boolean" ? typeof value === "boolean" : true;
  if (!valid) throw new TtaSdkError(`Tělo požadavku neodpovídá TTA Swaggeru (${label} má být ${type}).`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new TtaSdkError(`Tělo požadavku obsahuje nepovolenou hodnotu (${label}).`);
  if (type === "object") {
    const body = asRecord(value)!;
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const name of required) if (!(name in body)) throw new TtaSdkError(`V těle požadavku chybí povinné pole ${label}.${name}.`);
    const properties = asRecord(schema.properties) ?? {};
    for (const [name, child] of Object.entries(properties)) {
      if (name in body) validateBodySchema(body[name], child, document, `${label}.${name}`, depth + 1);
    }
  } else if (type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateBodySchema(item, schema.items, document, `${label}[${index}]`, depth + 1));
  }
}

function swaggerRequestUrl(row: ConnectionRow, document: SwaggerDocument, operation: SwaggerOperation, pathParameters: Record<string, string>): URL {
  let routePath = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = pathParameters[name];
    if (value === undefined) throw new TtaSdkError(`Chybí path parametr ${name}.`);
    return encodeURIComponent(value);
  });
  if (/[{}]/.test(routePath) || routePath.includes("\\") || routePath.includes("?") || routePath.includes("#") || routePath.split("/").some((segment) => segment === "..")) {
    throw new TtaSdkError("Cesta TTA operace obsahuje nevyplněný nebo nepovolený segment.");
  }
  const specBasePath = typeof document.basePath === "string" ? document.basePath : "";
  let candidate = `${specBasePath.replace(/\/+$/, "")}/${routePath.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  if (!candidate.startsWith("/")) candidate = `/${candidate}`;
  let decodedCandidate = candidate;
  try { decodedCandidate = decodeURIComponent(candidate); } catch { throw new TtaSdkError("Cesta TTA operace obsahuje neplatné URL kódování."); }
  if (decodedCandidate.split("/").some((segment) => segment === "..")) throw new TtaSdkError("Cesta TTA operace obsahuje nepovolený segment '..'.");
  const baseUrl = new URL(row.base_url);
  const connectionPath = baseUrl.pathname.replace(/\/+$/, "");
  const apiPath = normalizeApiPath(row.sdk_path).replace(/\/+$/, "");
  let finalPath: string;
  if (candidate === apiPath || candidate.startsWith(`${apiPath}/`) || candidate.includes(`${apiPath}/`)) {
    finalPath = connectionPath && !candidate.startsWith(connectionPath) ? `${connectionPath}${candidate}` : candidate;
  } else if (connectionPath && (candidate === connectionPath || candidate.startsWith(`${connectionPath}/`))) {
    const tail = candidate.slice(connectionPath.length);
    finalPath = `${connectionPath}${apiPath}${tail}`.replace(/\/{2,}/g, "/");
  } else if (specBasePath) {
    const combined = `${specBasePath.replace(/\/+$/, "")}${apiPath}/${routePath.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
    finalPath = connectionPath && !combined.startsWith(connectionPath) ? `${connectionPath}${combined}` : combined;
  } else {
    finalPath = `${connectionPath}${apiPath}${candidate}`.replace(/\/{2,}/g, "/");
  }
  baseUrl.pathname = finalPath;
  baseUrl.search = "";
  baseUrl.hash = "";
  for (const [name, value] of Object.entries(pathParameters)) {
    if (operation.parameters.some((parameter) => parameter.in === "path" && parameter.name === name) && !operation.path.includes(`{${name}}`)) {
      throw new TtaSdkError(`Path parametr ${name} není v cestě operace.`);
    }
    void value;
  }
  return baseUrl;
}

function swaggerRequestBody(operation: SwaggerOperation, document: SwaggerDocument, body: unknown, formData: Record<string, unknown>) {
  const formParameters = operation.parameters.filter((parameter) => parameter.in === "formData");
  if (formParameters.length) {
    if (body !== undefined) throw new TtaSdkError("TTA Swagger očekává formData, nikoli JSON body.");
    const allowed = new Set(formParameters.map((parameter) => parameter.name));
    for (const name of Object.keys(formData)) if (!allowed.has(name)) throw new TtaSdkError(`Parametr ${name} není v TTA Swaggeru deklarován jako formData.`);
    const supplied: Record<string, string> = {};
    for (const parameter of formParameters) {
      const value = formData[parameter.name];
      if ((value === undefined || value === null) && parameter.required) throw new TtaSdkError(`Chybí povinný formData parametr ${parameter.name}.`);
      if (value === undefined || value === null || parameter.type === "file") continue;
      const formatted = parameterValue(value, parameter);
      if (/[\r\n]/.test(formatted)) throw new TtaSdkError(`Parametr ${parameter.name} obsahuje nepovolený nový řádek.`);
      if (Array.isArray(parameter.enum) && !parameter.enum.some((item) => String(item) === formatted)) throw new TtaSdkError(`Parametr ${parameter.name} nemá povolenou hodnotu podle TTA Swaggeru.`);
      supplied[parameter.name] = formatted;
    }
    const declaredTypes = operation.consumes ?? document.consumes ?? [];
    const fileParameters = formParameters.filter((parameter) => parameter.type === "file");
    if (fileParameters.length) {
      if (!declaredTypes.includes("multipart/form-data")) throw new TtaSdkError("TTA Swagger deklaruje upload souboru mimo multipart/form-data.", null, "SDK_UNAVAILABLE");
      const boundary = `----tta-mcp-${randomUUID().replace(/-/g, "")}`;
      const parts: Buffer[] = [];
      for (const parameter of formParameters) {
        const value = formData[parameter.name];
        if (value === undefined || value === null) continue;
        const file = parameter.type === "file" ? asRecord(value) : null;
        let content: Buffer;
        let fileName = "";
        let contentType = "text/plain; charset=utf-8";
        if (parameter.type === "file") {
          if (typeof file?.dataBase64 !== "string" || typeof file.fileName !== "string") throw new TtaSdkError(`Soubor ${parameter.name} vyžaduje objekt fileName/dataBase64.`);
          if (/[\r\n]/.test(file.fileName)) throw new TtaSdkError(`Název souboru ${parameter.name} obsahuje nepovolené znaky.`);
          content = Buffer.from(file.dataBase64, "base64");
          if (!content.length || content.length > MAX_RESPONSE_BYTES || content.toString("base64").replace(/=+$/, "") !== file.dataBase64.replace(/=+$/, "")) throw new TtaSdkError(`Soubor ${parameter.name} má neplatná base64 data nebo překračuje limit 2 MB.`);
          fileName = file.fileName.replace(/[\r\n"\\]/g, "_").slice(0, 180);
          contentType = typeof file.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(file.contentType) ? file.contentType : "application/octet-stream";
        } else {
          content = Buffer.from(supplied[parameter.name] ?? "", "utf8");
        }
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${parameter.name.replace(/[\r\n"\\]/g, "_")}"${fileName ? `; filename="${fileName}"` : ""}\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8"), content, Buffer.from("\r\n", "utf8"));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
      const output = Buffer.concat(parts);
      if (output.length > MAX_RESPONSE_BYTES) throw new TtaSdkError("Upload překračuje limit 2 MB.");
      return { body: output, contentType: `multipart/form-data; boundary=${boundary}` };
    }
    if (!declaredTypes.includes("application/x-www-form-urlencoded")) throw new TtaSdkError("TTA operace vyžaduje nepodporovaný formData content type.", null, "SDK_UNAVAILABLE");
    return { body: new URLSearchParams(supplied).toString(), contentType: "application/x-www-form-urlencoded; charset=utf-8" };
  }
  if (Object.keys(formData).length) throw new TtaSdkError("TTA Swagger pro tuto operaci formData parametry nedeklaruje.");
  const bodyParameter = operation.parameters.find((parameter) => parameter.in === "body");
  const requestBody = asRecord(operation.raw.requestBody);
  const requestBodyContent = asRecord(requestBody?.content) ?? {};
  const jsonRequestBody = requestBodyContent["application/json"] ?? Object.entries(requestBodyContent).find(([type]) => type.includes("json"))?.[1];
  const openApiSchema = asRecord(jsonRequestBody)?.schema;
  if ((bodyParameter?.required || requestBody?.required === true) && body === undefined) throw new TtaSdkError("Chybí povinné JSON body požadavku.");
  if (!bodyParameter && !requestBody && body !== undefined) throw new TtaSdkError("TTA Swagger pro tuto operaci JSON body nedeklaruje.");
  if (body !== undefined) validateBodySchema(body, bodyParameter?.schema ?? openApiSchema, document);
  if (body === undefined) return { body: undefined, contentType: undefined };
  const declaredTypes = operation.consumes ?? document.consumes ?? Object.keys(requestBodyContent);
  if (declaredTypes.length && !declaredTypes.some((type) => type.includes("json"))) throw new TtaSdkError("TTA Swagger pro tuto operaci nedeklaruje JSON body.", null, "SDK_UNAVAILABLE");
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) throw new TtaSdkError("Tělo požadavku překračuje limit 2 MB.");
  return { body, contentType: "application/json; charset=utf-8" };
}

export async function callTtaSwaggerOperation(vault: Vault, row: ConnectionRow, operationId: string,
  input: { pathParameters?: Record<string, unknown>; queryParameters?: Record<string, unknown>; headerParameters?: Record<string, unknown>; body?: unknown; formData?: Record<string, unknown> },
  mode: "READ" | "WRITE"): Promise<{ method: RestMethod; data: unknown }> {
  return withTtaSession(vault, row, async (sessionId) => {
    const operations = await getTtaSwaggerOperations(row, sessionId);
    const document = swaggerCache.get(row.id)?.document;
    if (!document) throw new TtaSdkError("TTA Swagger se nepodařilo načíst.", null, "SDK_UNAVAILABLE");
    const operation = swaggerOperation(operations, operationId);
    if (mode === "READ" && operation.method !== "GET") throw new TtaSdkError("Tato operace není GET. Použijte tta_api_write a potvrďte operationId.");
    if (mode === "WRITE" && operation.method === "GET") throw new TtaSdkError("GET operace se volají nástrojem tta_api_read.");
    const pathParameters = validateInputParameters(operation.parameters, input.pathParameters ?? {}, "path");
    const queryParameters = validateInputParameters(operation.parameters, input.queryParameters ?? {}, "query");
    const headerParameters = validateInputParameters(operation.parameters, input.headerParameters ?? {}, "header");
    for (const name of Object.keys(headerParameters)) {
      const lowerName = name.toLowerCase();
      if (["authorization", "host", "content-length", "connection", "cookie", "transfer-encoding", "origin", "referer", "proxy-authorization", "proxy-connection", "expect", "upgrade"].includes(lowerName)
        || lowerName.startsWith("x-forwarded-") || lowerName.startsWith("sec-")) {
        throw new TtaSdkError(`Hlavičku ${name} nelze přepsat přes MCP.`);
      }
    }
    const query: Record<string, QueryValue> = { ...queryParameters };
    const pathParametersDeclared = operation.parameters.filter((parameter) => parameter.in === "path");
    for (const parameter of pathParametersDeclared) if (parameter.required && pathParameters[parameter.name] === undefined) throw new TtaSdkError(`Chybí povinný path parametr ${parameter.name}.`);
    const extraPathNames = Object.keys(input.pathParameters ?? {}).filter((name) => !pathParametersDeclared.some((parameter) => parameter.name === name));
    if (extraPathNames.length) throw new TtaSdkError(`Path parametr ${extraPathNames[0]} není v TTA Swaggeru deklarován.`);
    const url = swaggerRequestUrl(row, document, operation, pathParameters);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value === undefined ? "" : String(value));
    const body = swaggerRequestBody(operation, document, input.body, input.formData ?? {});
    const accepts = operation.produces?.join(", ") || document.produces?.join(", ") || "application/json";
    const result = await restRequest<unknown>(row, operation.method, "", {
      requestUrl: url,
      query: {},
      ...(body.body !== undefined ? { body: body.body, contentType: body.contentType } : {}),
      headers: { accept: accepts, ...headerParameters },
      authorization: sessionId,
      requestLabel: `${operation.method} ${operation.path} (${operation.operationId})`,
      allowBinaryResponse: true,
    });
    return { method: operation.method, data: result };
  });
}

async function validateTtaSession(row: ConnectionRow, sessionId: string): Promise<boolean> {
  const validation = await restRequest(row, "POST", `users/sessions/${encodeURIComponent(sessionId)}/validate`, {
    requestLabel: "validaci relace (POST /users/sessions/{sessionId}/validate)",
  });
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
        requestLabel: "přihlášení SYSTEM_SESSION_ID (POST /users/sessions/single-sign-on)",
      });
    } else {
      session = await restRequest(row, "POST", "users/sessions", {
        body: { UserName: credentials.username, Password: credentials.secret, UnconditionalLogOn: false },
        authentication: true,
        requestLabel: "interní přihlášení (POST /users/sessions)",
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
        throw new TtaSdkError("Operace není v pojmenovaném TTA katalogu.");
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
