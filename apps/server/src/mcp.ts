import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { Store, ConnectionRow, TokenRow } from "./store.js";
import type { Vault } from "./vault.js";
import { digest, newOpaqueToken } from "./security.js";
import { callTtaSdk, probeConnection, safeConnection, TtaSdkError } from "./tta.js";

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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/password|secret|token|authorization|credential|session.?id|system.?session/i.test(key)) return [key, "[REDACTED]"];
      return [key, safeTtaOutput(item, depth + 1)];
    }));
  }
  if (typeof value === "string" && value.length > 20000) return value.slice(0, 20000) + "…[truncated]";
  return value;
}

function processIdentity(id?: string, name?: string, version?: number) {
  return { ...(id ? { Id: id } : {}), ...(name ? { Name: name } : {}), ...(version !== undefined ? { Version: version } : {}) };
}

function resultError(error: unknown) {
  const ttaError = error instanceof TtaSdkError ? error : null;
  return {
    code: ttaError?.code ?? "TTA_OPERATION_FAILED",
    message: ttaError?.message ?? "TTA SDK operace selhala.",
    ...(ttaError?.httpStatus ? { httpStatus: ttaError.httpStatus } : {}),
  };
}

function mayAccess(grant: Grant, id: string): boolean {
  return grant.connectionIds.includes("*") || grant.connectionIds.includes(id);
}

function createTools(store: Store, vault: Vault, grant: Grant) {
  const server = new McpServer({ name: "tta-mcp-server", version: "0.2.0" });
  server.registerTool("tta_connections_list", {
    description: "Vrátí pouze TTA připojení povolená tomuto MCP klientovi. Neobsahuje přihlašovací údaje.",
    inputSchema: z.object({}),
  }, async () => {
    const rows = store.db.prepare("SELECT * FROM connections WHERE enabled=1 ORDER BY name COLLATE NOCASE")
      .all() as ConnectionRow[];
    return textResult(rows.filter((row) => mayAccess(grant, row.id)).map(safeConnection));
  });

  server.registerTool("tta_connection_test", {
    description: "Ověří povolené TTA připojení přihlášením přes SDK JSON a validací session. Nevrací tajné údaje ani session ID.",
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
    select: (input: Record<string, unknown>) => { connectionId: string; service: string; method: string; parameters: Record<string, unknown> }) => {
    server.registerTool(name, { description, inputSchema }, async (input) => {
      const selected = select(input as Record<string, unknown>);
      const row = connectionForTool(selected.connectionId);
      if (!row) {
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "DENIED");
        return { ...textResult({ error: { code: "ACCESS_DENIED", message: "Připojení neexistuje nebo k němu tento MCP klient nemá přístup." } }), isError: true };
      }
      const start = Date.now();
      try {
        const result = await callTtaSdk(vault, row, selected.service, selected.method, selected.parameters);
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "SUCCESS");
        return textResult({ connectionId: selected.connectionId, operation: action, durationMs: Date.now() - start, data: safeTtaOutput(result) });
      } catch (error) {
        store.audit(`mcp:${grant.tokenId}`, action, selected.connectionId, "FAILED");
        return { ...textResult({ connectionId: selected.connectionId, operation: action, durationMs: Date.now() - start, error: resultError(error) }), isError: true };
      }
    });
  };

  registerReadTool("tta_processes_list", "Seznam procesních definic dostupných přihlášenému TTA uživateli s právem zobrazit jejich úlohy. Filtr lze omezit typem procesu a kategorií.",
    z.object({ connectionId: z.string().uuid(), processType: z.enum(["BUSINESS_PROCESS", "CASE_DEFINITION", "CASE_FRAGMENT"]).optional(), categoryName: z.string().trim().min(1).max(200).optional() }),
    "tta.process.list", (input) => {
      const types: Record<string, number> = { BUSINESS_PROCESS: 0, CASE_DEFINITION: 1, CASE_FRAGMENT: 2 };
      const processType = input.processType as string | undefined;
      return { connectionId: input.connectionId as string, service: "ProcessService", method: "GetProcessesSummary", parameters: {
        processesSummaryFilter: {
          AccessType: 9,
          ...(processType ? { UseProcessType: true, ProcessType: types[processType] } : { UseProcessType: false }),
          ...(input.categoryName ? { Category: { Name: input.categoryName } } : {}),
        },
      } };
    });

  const identitySchema = z.object({ connectionId: z.string().uuid(), processId: z.string().trim().min(1).max(200).optional(), processName: z.string().trim().min(1).max(200).optional(), version: z.number().positive().optional() })
    .refine((value) => Boolean(value.processId || value.processName), "Zadejte processId nebo processName.");
  registerReadTool("tta_process_details", "Vrátí metadata procesní definice (bez příloh a anotací) přes dokumentovanou ProcessService.GetProcessInfo2.",
    identitySchema, "tta.process.details", (input) => ({
      connectionId: input.connectionId as string, service: "ProcessService", method: "GetProcessInfo2",
      parameters: { processIdentity: processIdentity(input.processId as string | undefined, input.processName as string | undefined, input.version as number | undefined), processInfoFilter: 0 },
    }));

  registerReadTool("tta_process_help", "Vrátí text nápovědy publikovaný v konfiguraci procesní definice.",
    identitySchema, "tta.process.help", (input) => ({
      connectionId: input.connectionId as string, service: "ProcessService", method: "GetProcessHelpText",
      parameters: { processIdentity: processIdentity(input.processId as string | undefined, input.processName as string | undefined, input.version as number | undefined) },
    }));

  registerReadTool("tta_process_states", "Vrátí stavové uzly definované v procesní mapě.",
    identitySchema, "tta.process.states", (input) => ({
      connectionId: input.connectionId as string, service: "ProcessService", method: "GetProcessStatesSummary",
      parameters: { processIdentity: processIdentity(input.processId as string | undefined, input.processName as string | undefined, input.version as number | undefined) },
    }));

  registerReadTool("tta_job_state", "Vrátí aktuální stav jedné běžící nebo dokončené TTA job instance.",
    z.object({ connectionId: z.string().uuid(), jobId: z.string().trim().min(1).max(200) }), "tta.job.state", (input) => ({
      connectionId: input.connectionId as string, service: "JobService", method: "GetJobState", parameters: { jobIdentity: { Id: input.jobId } },
    }));

  registerReadTool("tta_job_history", "Vrátí historii jedné TTA job instance; associatedJobs lze zapnout pro přidružené joby.",
    z.object({ connectionId: z.string().uuid(), jobId: z.string().trim().min(1).max(200), associatedJobs: z.boolean().default(false) }), "tta.job.history", (input) => ({
      connectionId: input.connectionId as string, service: "JobService", method: "GetJobHistory2",
      parameters: { jobIdentity: { Id: input.jobId }, jobHistoryFilter: { AssociatedJobs: input.associatedJobs } },
    }));

  registerReadTool("tta_job_events", "Vrátí procesní události zadané TTA job instance.",
    z.object({ connectionId: z.string().uuid(), jobId: z.string().trim().min(1).max(200) }), "tta.job.events", (input) => ({
      connectionId: input.connectionId as string, service: "JobService", method: "GetJobEvents", parameters: { jobIdentity: { Id: input.jobId } },
    }));

  registerReadTool("tta_job_activities", "Vrátí aktivity jedné TTA job instance pro stav 0 pending, 1 taken, 2 offered, 3 suspended, 4 locked, 5 pending completion, 7 on hold, 8 awaiting event, 9 awaiting allocation, 10 saved, 128 live, 129 history, 130 evaluation failed nebo 131 completed.",
    z.object({ connectionId: z.string().uuid(), jobId: z.string().trim().min(1).max(200), activityStatus: z.number().int().refine((value) => [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 128, 129, 130, 131].includes(value), "Nepodporovaný stav aktivity.") }),
    "tta.activity.list", (input) => ({
      connectionId: input.connectionId as string, service: "ActivityService", method: "GetActivitiesInJobWithStatus",
      parameters: { jobIdentity: { Id: input.jobId }, liveActivityStatus: input.activityStatus },
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
