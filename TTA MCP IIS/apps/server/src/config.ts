import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function portValue(value: string | undefined): number {
  const port = Number(value ?? 8380);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TTA_PORT or HTTP_PLATFORM_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export interface AppConfig {
  host: string;
  port: number;
  basePath: string;
  dataDir: string;
  dbPath: string;
  vaultKey: Buffer;
  cookieSecure: boolean;
  publicOrigin?: string;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
  allowInsecureTtaHttp: boolean;
}

function readVaultKey(): Buffer {
  let source = process.env.TTA_VAULT_KEY;
  const keyFile = process.env.TTA_VAULT_KEY_FILE;
  const dpapiKeyFile = process.env.TTA_VAULT_KEY_DPAPI_FILE;
  if (dpapiKeyFile) {
    if (process.platform !== "win32") throw new Error("TTA_VAULT_KEY_DPAPI_FILE is available only on Windows.");
    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Security",
      "$cipher=[IO.File]::ReadAllBytes($env:TTA_VAULT_KEY_DPAPI_FILE)",
      "$key=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)",
      "try { [Console]::Out.Write([Convert]::ToBase64String($key)) } finally { [Array]::Clear($key,0,$key.Length); [Array]::Clear($cipher,0,$cipher.Length) }",
    ].join("; ");
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    try {
      source = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      throw new Error("The DPAPI-protected vault key could not be read. Check the IIS application-pool ACL and the Windows DPAPI key file.");
    }
    delete process.env.TTA_VAULT_KEY_DPAPI_FILE;
  } else if (keyFile) {
    source = readFileSync(resolve(keyFile), "utf8").trim();
  }
  delete process.env.TTA_VAULT_KEY;
  if (!source) {
    throw new Error("Provide the vault key at runtime with TTA_VAULT_KEY, TTA_VAULT_KEY_FILE or the Windows DPAPI file option.");
  }
  const key = Buffer.from(source.trim(), "base64");
  source = undefined;
  if (key.length !== 32) {
    key.fill(0);
    throw new Error("The vault key must be a base64-encoded 32-byte value.");
  }
  return key;
}

export function loadConfig(): AppConfig {
  const host = process.env.TTA_HOST ?? "127.0.0.1";
  const port = portValue(process.env.TTA_PORT ?? process.env.HTTP_PLATFORM_PORT);
  const basePathValue = process.env.TTA_BASE_PATH ?? "";
  const basePath = basePathValue === "" || basePathValue === "/"
    ? ""
    : `/${basePathValue.replace(/^\/+|\/+$/g, "")}`;
  if (basePath && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(basePath)) {
    throw new Error("TTA_BASE_PATH must contain only simple URL path segments, for example /tta-mcp.");
  }
  const defaultDataDir = process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "TTA MCP Server")
    : join(homedir(), ".local", "share", "tta-mcp-server");
  const dataDirValue = process.env.TTA_DATA_DIR ?? defaultDataDir;
  const dataDir = isAbsolute(dataDirValue) ? resolve(dataDirValue) : resolve(dataDirValue);
  const publicOrigin = process.env.TTA_PUBLIC_ORIGIN;
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("TTA_PUBLIC_ORIGIN must be an HTTPS origin, for example https://tta.example.com.");
    }
  }
  const cookieSecure = booleanValue(process.env.TTA_COOKIE_SECURE, Boolean(publicOrigin));
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost" && !publicOrigin) {
    throw new Error("Set TTA_PUBLIC_ORIGIN before binding the app outside loopback.");
  }

  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, "localhost:5173", "127.0.0.1:5173"]);
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, "http://localhost:5173", "http://127.0.0.1:5173"]);
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    allowedHosts.add(parsed.host.toLowerCase());
    allowedOrigins.add(parsed.origin);
  }

  return {
    host,
    port,
    basePath,
    dataDir,
    dbPath: join(dataDir, "tta-mcp.sqlite"),
    vaultKey: readVaultKey(),
    cookieSecure,
    ...(publicOrigin ? { publicOrigin } : {}),
    allowedHosts,
    allowedOrigins,
    allowInsecureTtaHttp: booleanValue(process.env.TTA_ALLOW_INSECURE_HTTP, false),
  };
}

export function newBootstrapCode(): string {
  return randomBytes(24).toString("base64url");
}
