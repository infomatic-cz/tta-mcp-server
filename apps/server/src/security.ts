import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Store, UserRow } from "./store.js";
import type { AppConfig } from "./config.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sessionCookie(value: string, config: AppConfig): string {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `tta_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(config: AppConfig): string {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `tta_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export interface AdminIdentity {
  id: string;
  username: string;
  role: "SYSTEM_ADMINISTRATOR";
}

declare module "fastify" {
  interface FastifyRequest {
    admin: AdminIdentity | null;
  }
}

export function registerAdminAuth(store: Store, config: AppConfig, app: import("fastify").FastifyInstance): void {
  app.decorateRequest("admin", null);
  app.addHook("preHandler", async (request, reply) => {
    const route = request.url.split("?", 1)[0] ?? "";
    const publicRoutes = new Set(["/api/setup", "/api/auth/login", "/api/auth/me"]);
    if (!route.startsWith("/api/") || publicRoutes.has(route)) return;

    const session = cookieValue(request, "tta_session");
    if (!session) {
      await reply.code(401).send({ error: "Přihlášení vypršelo. Přihlaste se znovu." });
      return;
    }
    const now = new Date().toISOString();
    const row = store.db.prepare(`
      SELECT u.id, u.username, u.role, u.active
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(digest(session), now) as Pick<UserRow, "id" | "username" | "role" | "active"> | undefined;
    if (!row || row.active !== 1) {
      await reply.header("set-cookie", clearSessionCookie(config)).code(401).send({ error: "Přihlášení vypršelo. Přihlaste se znovu." });
      return;
    }
    request.admin = { id: row.id, username: row.username, role: row.role };
  });
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): AdminIdentity | null {
  if (request.admin) return request.admin;
  void reply.code(401).send({ error: "Přihlášení je vyžadováno." });
  return null;
}
