import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { toWebRequest } from "@modelcontextprotocol/node";
import type { NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod/v4";
import { loadConfig, newBootstrapCode } from "./config.js";
import { Store, type ConnectionRow, type TokenRow, type UserRow } from "./store.js";
import { Vault } from "./vault.js";
import { clearSessionCookie, digest, equalText, hashPassword, newOpaqueToken, registerAdminAuth, sessionCookie, verifyPassword } from "./security.js";
import { connectionInput, invalidateTtaSession, normalizeBaseUrl, probeConnection, safeConnection, saveConnection } from "./tta.js";
import { connectStdio, createHttpMcpHandler, createMcpToken, findMcpToken, tokenToGrant } from "./mcp.js";

const config = loadConfig();
const store = new Store(config);
const vault = new Vault(config.vaultKey);
let setupCode = store.hasAdmin() ? null : newBootstrapCode();
let setupExpiresAt = setupCode ? Date.now() + 30 * 60 * 1000 : 0;

if (process.argv.includes("--stdio")) {
  await connectStdio(store, vault);
} else {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../web");
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  await app.register(fastifyRateLimit, { max: 120, timeWindow: "1 minute" });
  registerAdminAuth(store, config, app);

  app.addHook("onRequest", async (request, reply) => {
    const host = (request.headers.host ?? "").toLowerCase();
    if (!config.allowedHosts.has(host)) {
      await reply.code(403).send({ error: "Nepovolený Host header." });
      return;
    }
    const origin = request.headers.origin;
    if (origin) {
      let normalized: string;
      try { normalized = new URL(origin).origin; } catch { normalized = ""; }
      if (!config.allowedOrigins.has(normalized)) {
        await reply.code(403).send({ error: "Nepovolený Origin header." });
        return;
      }
    }
    reply.header("x-content-type-options", "nosniff")
      .header("x-frame-options", "DENY")
      .header("referrer-policy", "no-referrer")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=()")
      .header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });

  app.get("/health/live", async () => ({ status: "ok", version: "0.2.4" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      store.db.prepare("SELECT 1").get();
      return { status: "ready", database: "ok" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.get("/api/setup", async (request) => {
    const required = !store.hasAdmin();
    const remote = request.raw.socket.remoteAddress ?? "";
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const localHost = ["localhost", "127.0.0.1", `[::1]`, `localhost:${config.port}`, `127.0.0.1:${config.port}`, `[::1]:${config.port}`]
      .includes((request.headers.host ?? "").toLowerCase());
    const forwarded = request.headers["x-forwarded-for"];
    const localBootstrap = loopback && localHost && !forwarded;
    if (required && localBootstrap && (!setupCode || Date.now() >= setupExpiresAt)) {
      setupCode = newBootstrapCode();
      setupExpiresAt = Date.now() + 30 * 60 * 1000;
    }
    return {
      required,
      setupCode: required && setupCode && Date.now() < setupExpiresAt && localBootstrap ? setupCode : null,
      expiresAt: required && setupCode && Date.now() < setupExpiresAt && localBootstrap ? new Date(setupExpiresAt).toISOString() : null,
      localOnly: required && !localBootstrap,
    };
  });

  app.post("/api/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const schema = z.object({ setupCode: z.string().min(16).max(200), username: z.string().trim().min(3).max(80), password: z.string().min(12).max(256) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Zkontrolujte zadané hodnoty. Heslo musí mít alespoň 12 znaků." });
    if (store.hasAdmin() || !setupCode || Date.now() >= setupExpiresAt || !equalText(parsed.data.setupCode, setupCode)) {
      store.audit("anonymous", "setup.create", null, "DENIED");
      return reply.code(403).send({ error: "Instalační kód je neplatný nebo vypršel. Restartujte server a načtěte nový kód z lokální adresy." });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const userId = randomUUID();
    const now = new Date().toISOString();
    const transaction = store.db.transaction(() => {
      if (store.hasAdmin()) throw new Error("Instalace je již dokončena.");
      store.db.prepare("INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,'SYSTEM_ADMINISTRATOR',1,?)")
        .run(userId, parsed.data.username, passwordHash, now);
      store.audit(parsed.data.username, "auth.setup.complete", userId);
    });
    try { transaction(); } catch { return reply.code(409).send({ error: "První účet již byl vytvořen." }); }
    setupCode = null;
    setupExpiresAt = 0;
    const rawSession = newOpaqueToken();
    store.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .run(digest(rawSession), userId, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), now);
    reply.header("set-cookie", sessionCookie(rawSession, config));
    return { user: { id: userId, username: parsed.data.username, role: "SYSTEM_ADMINISTRATOR" } };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(256) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Zadejte uživatelské jméno a heslo." });
    const user = store.db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1")
      .get(parsed.data.username) as UserRow | undefined;
    if (!user || !(await verifyPassword(user.password_hash, parsed.data.password))) {
      store.audit(parsed.data.username, "auth.login", null, "DENIED");
      return reply.code(401).send({ error: "Nesprávné přihlašovací údaje." });
    }
    const rawSession = newOpaqueToken();
    const now = new Date().toISOString();
    store.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .run(digest(rawSession), user.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), now);
    store.audit(user.username, "auth.login", user.id);
    reply.header("set-cookie", sessionCookie(rawSession, config));
    return { user: { id: user.id, username: user.username, role: user.role } };
  });

  app.get("/api/auth/me", async (request) => {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tta_session="));
    const raw = cookie?.slice("tta_session=".length);
    if (!raw) return { user: null };
    const user = store.db.prepare(`SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(decodeURIComponent(raw)), new Date().toISOString()) as { id: string; username: string; role: string } | undefined;
    return { user: user ?? null };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tta_session="));
    const raw = cookie?.slice("tta_session=".length);
    if (raw) store.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(decodeURIComponent(raw)));
    reply.header("set-cookie", clearSessionCookie(config));
    return { ok: true };
  });

  app.get("/api/dashboard", async (request) => {
    const total = (store.db.prepare("SELECT count(*) AS n FROM connections").get() as { n: number }).n;
    const enabled = (store.db.prepare("SELECT count(*) AS n FROM connections WHERE enabled=1").get() as { n: number }).n;
    const tokens = (store.db.prepare("SELECT count(*) AS n FROM mcp_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)").get(new Date().toISOString()) as { n: number }).n;
    const audit = store.db.prepare("SELECT action, target, result, created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT 5").all();
    const apiCompatible = (store.db.prepare("SELECT count(*) AS n FROM connections WHERE enabled=1 AND last_status='API_COMPATIBLE'").get() as { n: number }).n;
    return { user: request.admin?.username, totalConnections: total, enabledConnections: enabled, activeMcpTokens: tokens, apiStatus: apiCompatible ? "VERIFIED" : "UNVERIFIED", apiCompatibleConnections: apiCompatible, recentActivity: audit };
  });

  app.get("/api/connections", async () => {
    const rows = store.db.prepare("SELECT * FROM connections ORDER BY name COLLATE NOCASE").all() as ConnectionRow[];
    return rows.map(safeConnection);
  });
  app.post("/api/connections", async (request, reply) => {
    const parsed = connectionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Neplatná konfigurace připojení." });
    try {
      const row = saveConnection(store, vault, config, parsed.data);
      store.audit(request.admin?.username ?? "admin", "tta.connection.create", row.id);
      return reply.code(201).send(safeConnection(row));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Připojení se nepodařilo uložit." });
    }
  });
  app.put<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    const parsed = connectionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Neplatná konfigurace připojení." });
    try {
      const row = saveConnection(store, vault, config, parsed.data, request.params.id);
      store.audit(request.admin?.username ?? "admin", "tta.connection.update", row.id);
      return safeConnection(row);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Připojení se nepodařilo upravit." });
    }
  });
  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    const row = store.db.prepare("SELECT id FROM connections WHERE id=?").get(request.params.id) as { id: string } | undefined;
    if (!row) return reply.code(404).send({ error: "Připojení nebylo nalezeno." });
    store.db.prepare("DELETE FROM connections WHERE id=?").run(row.id);
    invalidateTtaSession(row.id);
    store.audit(request.admin?.username ?? "admin", "tta.connection.delete", row.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (request, reply) => {
    const row = store.db.prepare("SELECT * FROM connections WHERE id=?").get(request.params.id) as ConnectionRow | undefined;
    if (!row) return reply.code(404).send({ error: "Připojení nebylo nalezeno." });
    const result = await probeConnection(store, vault, row);
    store.audit(request.admin?.username ?? "admin", "tta.connection.test", row.id, result.status);
    return { connectionId: row.id, ...result };
  });

  app.get("/api/mcp-tokens", async () => {
    const rows = store.db.prepare("SELECT * FROM mcp_tokens ORDER BY created_at DESC").all() as TokenRow[];
    return rows.map((row) => ({ id: row.id, name: row.name, connectionIds: JSON.parse(row.connection_ids) as string[], expiresAt: row.expires_at, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at }));
  });
  app.post("/api/mcp-tokens", async (request, reply) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), connectionIds: z.array(z.string().uuid()).max(100), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Vyplňte název, prostředí a platnou dobu expirace." });
    const uniqueIds = [...new Set(parsed.data.connectionIds)];
    const count = uniqueIds.length ? (store.db.prepare(`SELECT count(*) AS n FROM connections WHERE id IN (${uniqueIds.map(() => "?").join(",")})`).get(...uniqueIds) as { n: number }).n : 0;
    if (count !== uniqueIds.length) return reply.code(400).send({ error: "Vybrané připojení neexistuje." });
    const created = createMcpToken(store, parsed.data.name, uniqueIds, parsed.data.expiresInDays ?? undefined);
    return reply.code(201).send(created);
  });
  app.delete<{ Params: { id: string } }>("/api/mcp-tokens/:id", async (request, reply) => {
    const row = store.db.prepare("SELECT id FROM mcp_tokens WHERE id=? AND revoked_at IS NULL").get(request.params.id) as { id: string } | undefined;
    if (!row) return reply.code(404).send({ error: "Aktivní MCP token nebyl nalezen." });
    store.db.prepare("UPDATE mcp_tokens SET revoked_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    store.audit(request.admin?.username ?? "admin", "mcp.token.revoke", row.id);
    return { ok: true };
  });

  app.get("/api/audit", async () => store.db.prepare("SELECT id,actor,action,target,result,created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT 200").all());
  app.get("/api/tools", async () => [
    { name: "tta_connections_list", description: "Seznam povolených připojení bez tajných údajů.", risk: "READ", availability: "AVAILABLE" },
    { name: "tta_connection_test", description: "Ověření přihlášení a REST API relace.", risk: "READ", availability: "AVAILABLE" },
    ...[
      ["tta_jobs_list", "Seznam jobů podle TTA query", "job.read"],
      ["tta_jobs_count", "Počet jobů podle TTA query", "job.read"],
      ["tta_job_details", "Detail job instance", "job.read"],
      ["tta_job_state", "Stav job instance", "job.read"],
      ["tta_job_history", "Historie job instance", "job.read"],
      ["tta_job_events", "Události job instance", "job.read"],
      ["tta_job_variables", "Proměnné job instance", "job.read"],
      ["tta_activities_query", "Aktivity podle TTA query", "activity.read"],
      ["tta_activities_workqueue", "Fronta práce uživatele", "activity.read"],
      ["tta_activities_count", "Počet aktivit", "activity.read"],
    ].map(([name, description, capability]) => ({ name, description, risk: "READ", capability, availability: "AVAILABLE_AFTER_TTA_AUTH" })),
  ]);

  const mcpHandler = createHttpMcpHandler(store, vault);
  app.all("/tta-mcp", async (request, reply) => {
    const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) {
      return reply.code(401).header("www-authenticate", "Bearer").send({ error: "MCP access token je vyžadován." });
    }
    const token = findMcpToken(store, bearer);
    if (!token) {
      return reply.code(401).header("www-authenticate", "Bearer").send({ error: "MCP access token je neplatný nebo expiroval." });
    }
    store.db.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?").run(new Date().toISOString(), token.id);
    const grant = tokenToGrant(token);
    const webRequest = await toWebRequest(request.raw as unknown as NodeIncomingMessageLike, request.body);
    const result = await mcpHandler.fetch(webRequest, {
      authInfo: { token: "[redacted]", clientId: token.id, scopes: [], extra: grant },
    });
    reply.hijack();
    const headers = Object.fromEntries(result.headers.entries());
    reply.raw.writeHead(result.status, headers);
    if (result.body) Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(reply.raw);
    else reply.raw.end();
  });

  app.get("/", async (_request, reply) => {
    const index = resolve(rootDir, "index.html");
    if (!existsSync(index)) return reply.code(503).type("text/plain").send("Web application build not found. Run New-Build.ps1.");
    return reply.type("text/html; charset=utf-8").send(createReadStream(index));
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/tta-mcp") || request.url.startsWith("/health/")) {
      return reply.code(404).send({ error: "Požadovaný endpoint nebyl nalezen." });
    }
    const asset = request.url.split("?")[0]?.replace(/^\//, "");
    if (asset && !asset.includes("..")) {
      const path = resolve(rootDir, asset);
      if (path.startsWith(rootDir) && existsSync(path)) {
        const contentType: Record<string, string> = {
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
          ".json": "application/json; charset=utf-8",
        };
        return reply.type(contentType[extname(path).toLowerCase()] ?? "application/octet-stream").send(createReadStream(path));
      }
    }
    return reply.type("text/html; charset=utf-8").send(createReadStream(resolve(rootDir, "index.html")));
  });

  const shutdown = async () => {
    await mcpHandler.close();
    await app.close();
    store.close();
    config.vaultKey.fill(0);
  };
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, "TTA MCP Server is ready");
  if (setupCode) app.log.info("First administrator setup is available only from the local host at /.");
}
