import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { Store, ConnectionRow, TokenRow } from "./store.js";
import { digest, newOpaqueToken } from "./security.js";
import { probeConnection, safeConnection } from "./tta.js";

interface Grant {
  tokenId: string;
  connectionIds: string[];
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function mayAccess(grant: Grant, id: string): boolean {
  return grant.connectionIds.includes("*") || grant.connectionIds.includes(id);
}

function createTools(store: Store, grant: Grant) {
  const server = new McpServer({ name: "tta-mcp-server", version: "0.1.2" });
  server.registerTool("tta_connections_list", {
    description: "Vrátí pouze TTA připojení povolená tomuto MCP klientovi. Neobsahuje přihlašovací údaje.",
    inputSchema: z.object({}),
  }, async () => {
    const rows = store.db.prepare("SELECT * FROM connections WHERE enabled=1 ORDER BY name COLLATE NOCASE")
      .all() as ConnectionRow[];
    return textResult(rows.filter((row) => mayAccess(grant, row.id)).map(safeConnection));
  });

  server.registerTool("tta_connection_test", {
    description: "Provede bezpečný HTTP GET test dosažitelnosti povolené TTA adresy. Neprovádí operace nad procesy ani nezaručuje kompatibilitu TTA API.",
    inputSchema: z.object({ connectionId: z.string().uuid() }),
  }, async ({ connectionId }) => {
    const row = store.db.prepare("SELECT * FROM connections WHERE id=? AND enabled=1").get(connectionId) as ConnectionRow | undefined;
    if (!row || !mayAccess(grant, row.id)) {
      store.audit(`mcp:${grant.tokenId}`, "tta.connection.test", connectionId, "DENIED");
      return { ...textResult({ error: "Připojení neexistuje nebo k němu tento MCP klient nemá přístup." }), isError: true };
    }
    const result = await probeConnection(store, row);
    store.audit(`mcp:${grant.tokenId}`, "tta.connection.test", connectionId, result.status);
    return textResult({ connectionId, name: row.name, ...result });
  });
  return server;
}

export function createHttpMcpHandler(store: Store) {
  return createMcpHandler(({ authInfo }) => {
    const extra = authInfo?.extra as { tokenId?: string; connectionIds?: string[] } | undefined;
    return createTools(store, {
      tokenId: extra?.tokenId ?? "unknown",
      connectionIds: extra?.connectionIds ?? [],
    });
  });
}

export async function connectStdio(store: Store): Promise<void> {
  const rows = store.db.prepare("SELECT id FROM connections WHERE enabled=1").all() as Array<{ id: string }>;
  const server = createTools(store, { tokenId: "local-stdio", connectionIds: rows.map((row) => row.id) });
  await server.connect(new StdioServerTransport());
}

export function findMcpToken(store: Store, rawToken: string): TokenRow | undefined {
  const row = store.db.prepare("SELECT * FROM mcp_tokens WHERE token_hash=? AND revoked_at IS NULL")
    .get(digest(rawToken)) as TokenRow | undefined;
  if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return undefined;
  return row;
}

export function tokenToGrant(row: TokenRow) {
  let connectionIds: string[];
  try {
    const parsed: unknown = JSON.parse(row.connection_ids);
    connectionIds = Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch {
    connectionIds = [];
  }
  return { tokenId: row.id, connectionIds };
}

export function createMcpToken(store: Store, name: string, connectionIds: string[], expiresInDays?: number) {
  const secret = newOpaqueToken();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null;
  store.db.prepare(`INSERT INTO mcp_tokens(id,name,token_hash,connection_ids,expires_at,created_at)
    VALUES(?,?,?,?,?,?)`).run(id, name, digest(secret), JSON.stringify(connectionIds), expiresAt, createdAt);
  store.audit("admin", "mcp.token.create", id);
  return { id, name, secret, connectionIds, expiresAt, createdAt };
}
