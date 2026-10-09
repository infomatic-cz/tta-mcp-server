import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { Store, ConnectionRow, TokenRow } from "./store.js";
import type { Vault } from "./vault.js";
import { digest, newOpaqueToken } from "./security.js";
import { callTtaApi, probeConnection, safeConnection, TtaSdkError } from "./tta.js";

interface Grant {
  tokenId: string;
  connectionIds: string[];
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function safeTtaOutput(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[nested value omitted]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => safeTtaOutput(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const variableName = [record.DisplayName, record.Name, record.VarId].filter((item) => typeof item === "string").join(" ");
    return Object.fromEntries(Object.entries(record).map(([key, item]) => {
      if (/password|secret|token|authorization|credential|session.?id|system.?session/i.test(key)) return [key, "[REDACTED]"];
      if (key.toLowerCase() === "value" && /password|secret|token|credential|session.?id|api.?key/i.test(variableName)) return [key, "[REDACTED]"];
      return [key, safeTtaOutput(item, depth + 1)];
    }));
  }
  if (typeof value === "string" && value.length > 20000) return value.slice(0, 20000) + "…[truncated]";
  return value;
}

function resultError(error: unknown) {
  const ttaError = error instanceof TtaSdkError ? error : null;
  return {
    code: ttaError?.code ?? "TTA_OPERATION_FAILED",
    message: ttaError?.message ?? "TTA REST operace selhala.",
    ...(ttaError?.httpStatus ? { httpStatus: ttaError.httpStatus } : {}),
  };
}

function mayAccess(grant: Grant, id: string): boolean {
  return grant.connectionIds.includes("*") || grant.connectionIds.includes(id);
}

function createTools(store: Store, vault: Vault, grant: Grant) {
  const server = new McpServer({ name: "tta-mcp-server", version: "0.2.6" });
  server.registerTool("tta_connections_list", {
    description: "Vrátí pouze TTA připojení povolená tomuto MCP klientovi. Neobsahuje přihlašovací údaje.",
    inputSchema: z.object({}),
  }, async () => {
    const rows = store.db.prepare("SELECT * FROM connections WHERE enabled=1 ORDER BY name COLLATE NOCASE")
      .all() as ConnectionRow[];
    return textResult(rows.filter((row) => mayAccess(grant, row.id)).map(safeConnection));
  });

  server.registerTool("tta_connection_test", {
    description: "Ověří povolené TTA připojení autentizací přes REST API a validací relace. Nevrací tajné údaje ani session ID.",
    inputSchema: z.object({ connectionId: z.string().uuid() }),
  }, async ({ connectionId }) => {
    const row = store.db.prepare("SELECT * FROM connections WHERE id=? AND enabled=1").get(connectionId) as ConnectionRow | undefined;
    if (!row || !mayAccess(grant, row.id)) {
      store.audit(`mcp:${grant.tokenId}`, "tta.connection.test", connectionId, "DENIED");
      return { ...textResult({ error: "Připojení neexistuje nebo k němu tento MCP klient nemá přístup." }), isError: true };
    }
    const result = await probeConnection(store, vault, row);
    store.audit(`mcp:${grant.tokenId}`, "tta.connection.test", connectionId, result.status);
    return textResult({ connectionId, name: row.name, ...result });
  });

  const connectionForTool = (connectionId: string): ConnectionRow | null => {
    const row = store.db.prepare("SELECT * FROM connections WHERE id=? AND enabled=1").get(connectionId) as ConnectionRow | undefined;
    return row && mayAccess(grant, row.id) ? row : null;
  };
  const registerReadTool = (name: string, description: string, inputSchema: z.ZodType, action: string,
    select: (input: Record<string, unknown>) => { connectionId: string; operation: string; parameters: Record<string, unknown> }) => {
    server.registerTool(name, { description, inputSchema }, async (input) => {
      const selected = select(input as Record<string, unknown>);
      const row = connectionForTool(selected.connectionId);
      if (!row) {
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "DENIED");
        return { ...textResult({ error: { code: "ACCESS_DENIED", message: "Připojení neexistuje nebo k němu tento MCP klient nemá přístup." } }), isError: true };
      }
      const start = Date.now();
      try {
        const result = await callTtaApi(vault, row, selected.operation, selected.parameters);
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "SUCCESS");
        return textResult({ connectionId: selected.connectionId, operation: action, durationMs: Date.now() - start, data: safeTtaOutput(result) });
      } catch (error) {
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "FAILED");
        return { ...textResult({ connectionId: selected.connectionId, operation: action, durationMs: Date.now() - start, error: resultError(error) }), isError: true };
      }
    });
  };

  registerReadTool("tta_jobs_list", "Vyhledá TTA joby pomocí názvu dotazu (query) nakonfigurovaného v TotalAgility.",
    z.object({ connectionId: z.string().uuid(), queryName: z.string().trim().min(1).max(200) }), "tta.jobs.list", (input) => ({
      connectionId: input.connectionId as string, operation: "jobs.list", parameters: { queryName: input.queryName as string },
    }));

  registerReadTool("tta_jobs_count", "Vrátí počet jobů pro TTA query nakonfigurovaný v TotalAgility.",
    z.object({ connectionId: z.string().uuid(), queryName: z.string().trim().min(1).max(200) }), "tta.jobs.count", (input) => ({
      connectionId: input.connectionId as string, operation: "jobs.count", parameters: { queryName: input.queryName as string },
    }));

  const jobIdSchema = z.object({ connectionId: z.string().uuid(), jobId: z.string().trim().min(1).max(200) });
  registerReadTool("tta_job_details", "Vrátí vlastnosti job instance včetně dostupných proměnných, událostí a historie.",
    jobIdSchema.extend({ associatedJobsHistory: z.boolean().default(false) }), "tta.job.details", (input) => ({
      connectionId: input.connectionId as string, operation: "job.details", parameters: { jobId: input.jobId as string, associatedJobsHistory: input.associatedJobsHistory as boolean },
    }));

  registerReadTool("tta_job_state", "Vrátí stav konkrétní TTA job instance.",
    jobIdSchema, "tta.job.state", (input) => ({
      connectionId: input.connectionId as string, operation: "job.state", parameters: { jobId: input.jobId as string },
    }));

  registerReadTool("tta_job_history", "Vrátí historii TTA job instance; lze zahrnout i historii přidružených jobů.",
    jobIdSchema.extend({ associatedJobsHistory: z.boolean().default(false) }), "tta.job.history", (input) => ({
      connectionId: input.connectionId as string, operation: "job.history", parameters: { jobId: input.jobId as string, associatedJobsHistory: input.associatedJobsHistory as boolean },
    }));

  registerReadTool("tta_job_variables", "Vrátí kolekci proměnných konkrétní TTA job instance.",
    jobIdSchema, "tta.job.variables", (input) => ({
      connectionId: input.connectionId as string, operation: "job.variables", parameters: { jobId: input.jobId as string },
    }));

  registerReadTool("tta_job_events", "Vrátí události připojené ke konkrétní TTA job instanci.",
    jobIdSchema, "tta.job.events", (input) => ({
      connectionId: input.connectionId as string, operation: "job.events", parameters: { jobId: input.jobId as string },
    }));

  registerReadTool("tta_activities_query", "Vrátí aktivity podle pojmenovaného TTA dotazu.",
    z.object({ connectionId: z.string().uuid(), queryName: z.string().trim().min(1).max(200) }), "tta.activities.query", (input) => ({
      connectionId: input.connectionId as string, operation: "activities.query", parameters: { queryName: input.queryName as string },
    }));

  registerReadTool("tta_activities_workqueue", "Vrátí položky fronty práce dostupné přihlášenému TTA uživateli podle query; výsledky respektují jeho dovednosti a oprávnění.",
    z.object({ connectionId: z.string().uuid(), queryName: z.string().trim().min(1).max(200) }), "tta.activities.workqueue", (input) => ({
      connectionId: input.connectionId as string, operation: "activities.workqueue", parameters: { queryName: input.queryName as string },
    }));

  registerReadTool("tta_activities_count", "Vrátí počet aktivit podle TTA query, job ID nebo stavu.",
    z.object({ connectionId: z.string().uuid(), queryName: z.string().trim().min(1).max(200).optional(), jobId: z.string().trim().min(1).max(200).optional(), activityStatus: z.number().int().optional() })
      .refine((input) => Boolean(input.queryName || input.jobId || input.activityStatus !== undefined), "Zadejte queryName, jobId nebo activityStatus."),
    "tta.activities.count", (input) => ({
      connectionId: input.connectionId as string, operation: "activities.count", parameters: {
        ...(typeof input.queryName === "string" ? { queryName: input.queryName } : {}),
        ...(typeof input.jobId === "string" ? { jobId: input.jobId } : {}),
        ...(typeof input.activityStatus === "number" ? { activityStatus: input.activityStatus } : {}),
      },
    }));
  return server;
}

export function createHttpMcpHandler(store: Store, vault: Vault) {
  return createMcpHandler(({ authInfo }) => {
    const extra = authInfo?.extra as { tokenId?: string; connectionIds?: string[] } | undefined;
    return createTools(store, vault, {
      tokenId: extra?.tokenId ?? "unknown",
      connectionIds: extra?.connectionIds ?? [],
    });
  });
}

export async function connectStdio(store: Store, vault: Vault): Promise<void> {
  const rows = store.db.prepare("SELECT id FROM connections WHERE enabled=1").all() as Array<{ id: string }>;
  const server = createTools(store, vault, { tokenId: "local-stdio", connectionIds: rows.map((row) => row.id) });
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
