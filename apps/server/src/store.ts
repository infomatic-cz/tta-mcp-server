import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AppConfig } from "./config.js";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: "SYSTEM_ADMINISTRATOR";
  active: number;
}

export interface ConnectionRow {
  id: string;
  name: string;
  base_url: string;
  deployment_type: "ON_PREMISE" | "CLOUD";
  tta_version: string | null;
  enabled: number;
  timeout_ms: number;
  credential_ciphertext: string | null;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface TokenRow {
  id: string;
  name: string;
  token_hash: string;
  connection_ids: string;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  result: string;
  created_at: string;
}

export class Store {
  readonly db: Database.Database;

  constructor(config: AppConfig) {
    mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(dirname(config.dbPath), 0o700);
    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role = 'SYSTEM_ADMINISTRATOR'),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        deployment_type TEXT NOT NULL CHECK(deployment_type IN ('ON_PREMISE','CLOUD')),
        tta_version TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        credential_ciphertext TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_status TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        connection_ids TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
    `);
    if (process.platform !== "win32") chmodSync(config.dbPath, 0o600);
  }

  hasAdmin(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE active = 1 LIMIT 1").get());
  }

  close(): void {
    this.db.close();
  }

  audit(actor: string, action: string, target: string | null, result = "SUCCESS"): void {
    this.db.prepare("INSERT INTO audit_events(id, actor, action, target, result, created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), actor, action, target, result, new Date().toISOString());
  }
}
