import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type User = { id: string; username: string; role: string };
type Connection = {
  id: string; name: string; baseUrl: string; deploymentType: "ON_PREMISE" | "CLOUD";
  version: string | null; enabled: boolean; timeoutMs: number; apiPath: string; authMode: "PASSWORD" | "SYSTEM_SESSION_ID"; credentialsStored: boolean;
  lastCheckedAt: string | null; lastStatus: string | null; lastError: string | null;
};
type Token = { id: string; name: string; connectionIds: string[]; expiresAt: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type AuditEvent = { id: string; actor: string; action: string; target: string | null; result: string; createdAt: string };
type Tab = "overview" | "connections" | "clients" | "tools" | "audit" | "settings";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Požadavek selhal (${response.status}).`);
  return payload;
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function App() {
  const [booting, setBooting] = useState(true);
  const [setup, setSetup] = useState<{ required: boolean; setupCode: string | null; expiresAt: string | null; localOnly: boolean }>({ required: false, setupCode: null, expiresAt: null, localOnly: false });
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [dashboard, setDashboard] = useState<{ totalConnections: number; enabledConnections: number; activeMcpTokens: number; apiStatus: string; apiCompatibleConnections: number; recentActivity: AuditEvent[] } | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<Connection | "new" | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { status: string; detail: string; durationMs: number }> | null>(null);
  const [newToken, setNewToken] = useState<{ id: string; name: string; secret: string; connectionIds: string[]; expiresAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSetup = useCallback(async () => {
    const state = await api<typeof setup>("/api/setup");
    setSetup(state);
  }, []);

  const refreshData = useCallback(async () => {
    const [home, connectionList, tokenList, auditList] = await Promise.all([
      api<typeof dashboard>("/api/dashboard"), api<Connection[]>("/api/connections"), api<Token[]>("/api/mcp-tokens"), api<AuditEvent[]>("/api/audit"),
    ]);
    setDashboard(home);
    setConnections(connectionList);
    setTokens(tokenList);
    setAudit(auditList);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [state, session] = await Promise.all([api<typeof setup>("/api/setup"), api<{ user: User | null }>("/api/auth/me")]);
        setSetup(state);
        setUser(session.user);
        if (session.user) await refreshData();
      } catch (error) { setToast(error instanceof Error ? error.message : "Server není dostupný."); }
      finally { setBooting(false); }
    })();
  }, [refreshData]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const login = async (username: string, password: string) => {
    const result = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setUser(result.user);
    await refreshData();
  };

  const setupAdmin = async (setupCode: string, username: string, password: string) => {
    const result = await api<{ user: User }>("/api/setup", { method: "POST", body: JSON.stringify({ setupCode, username, password }) });
    setUser(result.user);
    await refreshSetup();
    await refreshData();
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setTab("overview");
  };

  if (booting) return <div className="loading"><div className="brand-mark">T</div><span>Spouštím správu serveru…</span></div>;
  if (!user) return setup.required
    ? <SetupScreen state={setup} refresh={refreshSetup} onSetup={setupAdmin} />
    : <LoginScreen onLogin={login} />;

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">T</div><div><strong>TTA MCP</strong><span>SERVER CONSOLE</span></div></div>
      <div className="workspace-label">PRACOVNÍ PROSTŘEDÍ</div>
      <nav aria-label="Hlavní navigace">
        <NavButton id="overview" active={tab} onSelect={setTab} icon="▦" label="Přehled" />
        <NavButton id="connections" active={tab} onSelect={setTab} icon="◉" label="TTA připojení" badge={connections.length} />
        <NavButton id="clients" active={tab} onSelect={setTab} icon="⌘" label="MCP klienti" badge={tokens.filter((token) => !token.revokedAt).length} />
        <NavButton id="tools" active={tab} onSelect={setTab} icon="◇" label="MCP nástroje" />
        <NavButton id="audit" active={tab} onSelect={setTab} icon="≋" label="Auditní záznamy" />
      </nav>
      <div className="sidebar-bottom">
        <div className="service-state"><span className="pulse-dot" /><span><strong>Server běží</strong><small>Verze 0.2.2 · lokální správa</small></span></div>
        <button className="nav-button" onClick={() => setTab("settings")}><span className="nav-icon">⚙</span>Nastavení</button>
        <div className="profile"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="profile-name"><strong>{user.username}</strong><small>System Administrator</small></div><button aria-label="Odhlásit se" title="Odhlásit se" className="icon-button" onClick={() => void logout()}>↗</button></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-separator">/</span><strong>{tabLabel(tab)}</strong></div><div className="topbar-right"><span className="environment-pill"><span className="tiny-dot" />Lokální instance</span><button className="icon-button help-button" title="Obnovit data" onClick={() => void refreshData().catch(showError)}>↻</button></div></header>
      <div className="page-content">
        {tab === "overview" && dashboard && <Overview dashboard={dashboard} connections={connections} tokens={tokens} onNavigate={setTab} />}
        {tab === "connections" && <ConnectionsPage connections={connections} result={testResult} onAdd={() => setConnectionDialog("new")} onEdit={(item) => setConnectionDialog(item)} onTest={async (id) => {
          setBusy(true); try { const result = await api<{ status: string; detail: string; durationMs: number }>(`/api/connections/${id}/test`, { method: "POST" }); setTestResult((previous) => ({ ...(previous ?? {}), [id]: result })); await refreshData(); }
          catch (error) { showError(error); } finally { setBusy(false); }
        }} onDelete={async (item) => {
          if (!window.confirm(`Opravdu odstranit připojení „${item.name}“?`)) return;
          try { await api(`/api/connections/${item.id}`, { method: "DELETE" }); setToast("Připojení bylo odstraněno."); await refreshData(); } catch (error) { showError(error); }
        }} busy={busy} />}
        {tab === "clients" && <ClientsPage tokens={tokens} connections={connections} onCreate={async (name, connectionIds, expiresInDays) => {
          try { const created = await api<{ id: string; name: string; secret: string; connectionIds: string[]; expiresAt: string | null }>("/api/mcp-tokens", { method: "POST", body: JSON.stringify({ name, connectionIds, expiresInDays }) }); setNewToken(created); await refreshData(); }
          catch (error) { showError(error); }
        }} onRevoke={async (token) => {
          if (!window.confirm(`Opravdu zneplatnit token „${token.name}“? MCP klient okamžitě ztratí přístup.`)) return;
          try { await api(`/api/mcp-tokens/${token.id}`, { method: "DELETE" }); setToast("MCP token byl zneplatněn."); await refreshData(); } catch (error) { showError(error); }
        }} />}
        {tab === "tools" && <ToolsPage />}
        {tab === "audit" && <AuditPage events={audit} />}
        {tab === "settings" && <SettingsPage user={user} />}
      </div>
    </main>
    {connectionDialog && <ConnectionDialog initial={connectionDialog === "new" ? null : connectionDialog} onClose={() => setConnectionDialog(null)} onSave={async (form) => {
      setBusy(true);
      try {
        const path = connectionDialog === "new" ? "/api/connections" : `/api/connections/${connectionDialog.id}`;
        const method = connectionDialog === "new" ? "POST" : "PUT";
        await api(path, { method, body: JSON.stringify(form) });
        setConnectionDialog(null); setToast(connectionDialog === "new" ? "Připojení bylo přidáno." : "Změny byly uloženy."); await refreshData();
      } catch (error) { showError(error); } finally { setBusy(false); }
    }} busy={busy} />}
    {newToken && <TokenCreatedModal token={newToken} onClose={() => setNewToken(null)} />}
    {toast && <div className="toast" role="status"><span>●</span>{toast}<button onClick={() => setToast("")} aria-label="Zavřít">×</button></div>}
  </div>;

  function showError(error: unknown) { setToast(error instanceof Error ? error.message : "Požadavek se nepodařilo dokončit."); }
}

function tabLabel(tab: Tab) {
  return ({ overview: "Přehled", connections: "TTA připojení", clients: "MCP klienti", tools: "Katalog nástrojů", audit: "Auditní záznamy", settings: "Nastavení" })[tab];
}

function NavButton({ id, active, onSelect, icon, label, badge }: { id: Tab; active: Tab; onSelect: (tab: Tab) => void; icon: string; label: string; badge?: number }) {
  return <button className={`nav-button ${active === id ? "active" : ""}`} onClick={() => onSelect(id)}><span className="nav-icon">{icon}</span><span>{label}</span>{badge !== undefined && badge > 0 && <span className="nav-badge">{badge}</span>}</button>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({ dashboard, connections, tokens, onNavigate }: { dashboard: NonNullable<AppPropsDashboard>; connections: Connection[]; tokens: Token[]; onNavigate: (tab: Tab) => void }) {
  const live = connections.filter((item) => item.lastStatus === "API_COMPATIBLE").length;
  const cards = [
    { label: "Registrovaná prostředí", value: dashboard.totalConnections, note: `${dashboard.enabledConnections} aktivních`, icon: "◉", color: "blue" },
    { label: "Dosažitelná prostředí", value: live, note: "podle posledního testu", icon: "⌁", color: "green" },
    { label: "Aktivní MCP tokeny", value: dashboard.activeMcpTokens, note: "omezené podle prostředí", icon: "⌘", color: "purple" },
    { label: "Ověřené TTA API", value: dashboard.apiCompatibleConnections, note: "SDK přihlášení ověřeno", icon: "◇", color: "amber" },
  ];
  return <>
    <PageTitle eyebrow="PŘEHLED SERVERU" title="Dobrý den" description="Stav připojení, MCP přístupů a posledních aktivit." action={<button className="button secondary" onClick={() => onNavigate("connections")}>Spravovat připojení <span>→</span></button>} />
    <div className="stats-grid">{cards.map((card) => <div className="stat-card" key={card.label}><div className={`stat-icon ${card.color}`}>{card.icon}</div><div className="stat-label">{card.label}</div><div className="stat-value">{card.value}</div><div className="stat-note">{card.note}</div></div>)}</div>
    <div className="content-grid overview-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Připojení k TotalAgility</h2><p>Poslední stav autentizace a ověření REST API</p></div><button className="text-button" onClick={() => onNavigate("connections")}>Zobrazit vše <span>→</span></button></div>
        {connections.length === 0 ? <EmptyState icon="◉" title="Zatím žádné připojení" text="Přidejte první TTA prostředí a otestujte jeho dosažitelnost." action={<button className="button primary" onClick={() => onNavigate("connections")}>Přidat připojení</button>} /> : <div className="connection-list">{connections.slice(0, 4).map((item) => <div className="connection-row" key={item.id}><div className="connection-glyph">{item.deploymentType === "CLOUD" ? "☁" : "▣"}</div><div className="connection-main"><strong>{item.name}</strong><span>{item.baseUrl}</span></div><StatusBadge status={item.lastStatus} /><span className="row-version">{item.version ?? "Verze nezjištěna"}</span></div>)}</div>}
      </section>
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Poslední aktivita</h2><p>Administrace a přístupů MCP</p></div><button className="icon-button" title="Auditní záznamy" onClick={() => onNavigate("audit")}>↗</button></div>
        {dashboard.recentActivity.length === 0 ? <div className="quiet-empty">Zatím zde nejsou žádné záznamy.</div> : <div className="activity-list">{dashboard.recentActivity.map((event, index) => <div className="activity-row" key={`${event.action}-${event.createdAt}-${index}`}><span className={`activity-dot ${event.result === "SUCCESS" || event.result === "REACHABLE" ? "good" : "muted"}`} /><div><strong>{humanAction(event.action)}</strong><small>{event.target ? `${event.actor} · ${event.target.slice(0, 8)}` : event.actor}</small></div><time>{relativeDate(event.createdAt)}</time></div>)}</div>}
      </section>
    </div>
    <section className="panel quick-panel"><div className="panel-heading"><div><h2>Rychlé akce</h2><p>Nejčastější kroky správy</p></div></div><div className="quick-actions"><button onClick={() => onNavigate("connections")}><span className="quick-icon blue">＋</span><span><strong>Přidat TTA připojení</strong><small>Nová instalace nebo tenant</small></span><span className="quick-arrow">→</span></button><button onClick={() => onNavigate("clients")}><span className="quick-icon purple">⌘</span><span><strong>Vytvořit MCP přístup</strong><small>Token s omezeným přístupem</small></span><span className="quick-arrow">→</span></button><button onClick={() => onNavigate("tools")}><span className="quick-icon amber">◇</span><span><strong>Prohlédnout nástroje</strong><small>Funkce dostupné klientům</small></span><span className="quick-arrow">→</span></button></div></section>
    <div className="info-banner"><span className="info-symbol">i</span><div><strong>Read-only TTA SDK nástroje jsou dostupné po úspěšném přihlášení.</strong><p>Konkrétní operace se stále řídí oprávněními TTA účtu. Zápisové, dokumentové a Designer operace nejsou v tomto releasu vystaveny.</p></div><button onClick={() => onNavigate("tools")}>Detaily <span>→</span></button></div>
    <span className="sr-only">{tokens.length} MCP tokenů celkem</span>
  </>;
}
type AppPropsDashboard = { totalConnections: number; enabledConnections: number; activeMcpTokens: number; apiStatus: string; apiCompatibleConnections: number; recentActivity: AuditEvent[] };

function ConnectionsPage({ connections, result, onAdd, onEdit, onTest, onDelete, busy }: { connections: Connection[]; result: Record<string, { status: string; detail: string; durationMs: number }> | null; onAdd: () => void; onEdit: (item: Connection) => void; onTest: (id: string) => void; onDelete: (item: Connection) => void; busy: boolean }) {
  return <>
    <PageTitle eyebrow="INTEGRACE" title="TTA připojení" description="Nastavte základní URL REST API, autentizaci a ověřte skutečnou TTA relaci." action={<button className="button primary" onClick={onAdd}><span>＋</span> Přidat připojení</button>} />
    <div className="notice neutral"><span>i</span><div><strong>Test připojení ověřuje autentizaci i REST API relaci podle TTA Swaggeru.</strong><p>Pro cloud zadejte interní uživatelské jméno a heslo. SYSTEM_SESSION_ID je volitelný režim jednotného přihlášení.</p></div></div>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Registrovaná prostředí <span className="count-pill">{connections.length}</span></h2><p>Každý MCP klient dostane pouze připojení, která mu přiřadíte.</p></div><div className="table-controls"><span className="search-display">⌕ <span>Všechna prostředí</span></span></div></div>
      {connections.length === 0 ? <EmptyState icon="◉" title="Připojení zatím nejsou nastavena" text="Zadejte název, základní URL a cestu REST API. Přihlašovací údaje se ukládají šifrovaně." action={<button className="button primary" onClick={onAdd}>Přidat první připojení</button>} /> : <div className="table-scroll"><table><thead><tr><th>PROSTŘEDÍ</th><th>ADRESA</th><th>VERZE</th><th>STAV</th><th>POSLEDNÍ TEST</th><th aria-label="Akce" /></tr></thead><tbody>{connections.map((item) => <React.Fragment key={item.id}><tr><td><div className="table-connection"><div className="connection-glyph">{item.deploymentType === "CLOUD" ? "☁" : "▣"}</div><div><strong>{item.name}</strong><small>{item.deploymentType === "CLOUD" ? "Cloud" : "On-premise"} · {item.authMode === "PASSWORD" ? "interní heslo" : "SYSTEM_SESSION_ID"}{item.credentialsStored && <span className="secure-caption"> · 🔒 tajné údaje šifrovány</span>}</small></div></div></td><td><span className="mono-url">{item.baseUrl}{item.apiPath}</span></td><td>{item.version || <span className="muted-text">Nezjištěna</span>}</td><td><StatusBadge status={result?.[item.id]?.status ?? item.lastStatus} /></td><td><span className="date-cell">{date(item.lastCheckedAt)}</span></td><td><div className="row-actions"><button className="text-button" disabled={busy} onClick={() => onTest(item.id)}>Test REST API</button><button className="icon-button" title="Upravit" onClick={() => onEdit(item)}>···</button></div></td></tr>{result?.[item.id] && <tr className="result-row"><td colSpan={6}><span className={`result-mark ${["UNREACHABLE", "AUTH_REJECTED", "SDK_UNAVAILABLE"].includes(result[item.id]?.status ?? "") ? "bad" : "good"}`}>{["UNREACHABLE", "AUTH_REJECTED", "SDK_UNAVAILABLE"].includes(result[item.id]?.status ?? "") ? "!" : "✓"}</span><span>{result[item.id]?.detail}</span><small>{result[item.id]?.durationMs} ms</small></td></tr>}</React.Fragment>)}</tbody></table></div>}
    </section>
    <div className="split-cards"><div className="mini-card"><div className="mini-icon">◈</div><div><strong>Šifrování přihlašovacích údajů</strong><p>Hodnoty se šifrují AES-256-GCM. Šifrovací klíč je oddělen od databáze.</p></div></div><div className="mini-card"><div className="mini-icon amber-icon">◇</div><div><strong>Kompatibilita API</strong><p>Neznámé schopnosti zůstávají označené jako neověřené, nikoli podporované.</p></div></div></div>
  </>;
}

function ClientsPage({ tokens, connections, onCreate, onRevoke }: { tokens: Token[]; connections: Connection[]; onCreate: (name: string, connectionIds: string[], expiresInDays: number | null) => void; onRevoke: (token: Token) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [selected, setSelected] = useState<string[]>([]);
  const active = tokens.filter((token) => !token.revokedAt && (!token.expiresAt || Date.parse(token.expiresAt) > Date.now()));
  const submit = (event: React.FormEvent) => { event.preventDefault(); onCreate(name.trim(), selected, days ? Number(days) : null); setShowForm(false); setName(""); setDays("90"); setSelected([]); };
  return <>
    <PageTitle eyebrow="PŘÍSTUPY" title="MCP klienti" description="Vytvořte tokeny omezené na konkrétní TTA prostředí. Tajný token uvidíte pouze při vytvoření." action={<button className="button primary" onClick={() => setShowForm(true)}><span>＋</span> Vytvořit token</button>} />
    <div className="notice neutral"><span>⌘</span><div><strong>Každý klient používá vlastní přístupový token.</strong><p>Token lze kdykoliv zneplatnit. V databázi je uložen pouze jeho hash.</p></div></div>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Vydané tokeny <span className="count-pill">{active.length} aktivních</span></h2><p>Omezení přístupu a poslední použití</p></div></div>{tokens.length === 0 ? <EmptyState icon="⌘" title="Zatím žádní MCP klienti" text="Vytvořte token a vyberte, ke kterým TTA prostředím může přistupovat." action={<button className="button primary" onClick={() => setShowForm(true)}>Vytvořit první token</button>} /> : <div className="table-scroll"><table><thead><tr><th>NÁZEV</th><th>POVOLENÁ PROSTŘEDÍ</th><th>VYTVOŘEN</th><th>POSLEDNÍ POUŽITÍ</th><th>PLATNOST</th><th /></tr></thead><tbody>{tokens.map((token) => <tr key={token.id} className={token.revokedAt ? "revoked-row" : ""}><td><div className="token-name"><span className="token-glyph">⌘</span><strong>{token.name}</strong><span className={`token-state ${token.revokedAt ? "inactive" : "active"}`}>{token.revokedAt ? "Zneplatněn" : token.expiresAt && Date.parse(token.expiresAt) < Date.now() ? "Expiroval" : "Aktivní"}</span></div></td><td><div className="tag-list">{token.connectionIds.length ? token.connectionIds.map((id) => <span className="tag" key={id}>{connections.find((item) => item.id === id)?.name ?? "Odstraněné prostředí"}</span>) : <span className="muted-text">Bez přístupu</span>}</div></td><td>{date(token.createdAt)}</td><td>{date(token.lastUsedAt)}</td><td>{token.expiresAt ? date(token.expiresAt) : "Bez expirace"}</td><td>{!token.revokedAt && <button className="text-button danger-text" onClick={() => onRevoke(token)}>Zneplatnit</button>}</td></tr>)}</tbody></table></div>}</section>
    <section className="panel setup-panel"><div className="panel-heading"><div><h2>Připojení v klientovi</h2><p>HTTP MCP endpoint pro vzdálené klienty</p></div><span className="endpoint-chip">Streamable HTTP</span></div><div className="endpoint-box"><code>{window.location.origin}/tta-mcp</code><button className="copy-button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/tta-mcp`)}>Kopírovat</button></div><p className="small-help">Do klienta vložte URL a vytvořený bearer token. Lokální klienty lze spustit přes stdio podle <a href="https://github.com/infomatic-cz/tta-mcp-server" target="_blank" rel="noreferrer">dokumentace projektu</a>.</p></section>
    {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="modal" onSubmit={submit}><div className="modal-head"><div><div className="eyebrow">NOVÝ MCP PŘÍSTUP</div><h2>Vytvořit klientský token</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)}>×</button></div><label>Název klienta<input autoFocus required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="např. Codex vývoj" /></label><fieldset className="connection-checks"><legend>Povolená TTA prostředí</legend>{connections.length ? connections.map((item) => <label className="check-row" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((prev) => event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))} /><span><strong>{item.name}</strong><small>{item.baseUrl}</small></span></label>) : <p className="muted-text">Nejprve přidejte TTA připojení.</p>}</fieldset><label>Expirace<select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">30 dní</option><option value="90">90 dní</option><option value="180">180 dní</option><option value="365">365 dní</option><option value="">Bez expirace</option></select></label>{selected.length === 0 && <div className="field-warning">Vyberte alespoň jedno prostředí.</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Zrušit</button><button className="button primary" disabled={!name.trim() || selected.length === 0}>Vytvořit token</button></div></form></div>}
  </>;
}

function ToolsPage() {
  const tools = [
    { name: "tta_connections_list", area: "Připojení", risk: "READ", status: "AVAILABLE", text: "Vrátí pouze prostředí povolená danému MCP tokenu. Nezahrnuje tajné údaje." },
    { name: "tta_connection_test", area: "Diagnostika", risk: "READ", status: "AVAILABLE", text: "Přihlásí se přes REST API a ověří platnost relace." },
    { name: "tta_jobs_list", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vyhledá joby pomocí pojmenovaného TTA query." },
    { name: "tta_jobs_count", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí počet jobů z TTA query." },
    { name: "tta_job_details", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí vlastnosti jobu včetně dostupných proměnných, událostí a historie." },
    { name: "tta_job_state", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí stav konkrétní job instance." },
    { name: "tta_job_history", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí historii konkrétní job instance." },
    { name: "tta_job_events", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí události konkrétní job instance." },
    { name: "tta_job_variables", area: "Úlohy", risk: "READ", status: "AVAILABLE", text: "Vrátí proměnné konkrétní job instance." },
    { name: "tta_activities_query", area: "Aktivity", risk: "READ", status: "AVAILABLE", text: "Vyhledá aktivity přes pojmenované TTA query." },
    { name: "tta_activities_workqueue", area: "Aktivity", risk: "READ", status: "AVAILABLE", text: "Vrátí položky fronty práce dostupné účtu." },
    { name: "tta_activities_count", area: "Aktivity", risk: "READ", status: "AVAILABLE", text: "Vrátí počet aktivit podle query, jobu nebo stavu." },
    { name: "tta_document_*", area: "Dokumenty", risk: "READ / WRITE", status: "NOT_IMPLEMENTED", text: "Operace s dokumenty a binárním obsahem zatím nejsou vystaveny." },
  ];
  return <><PageTitle eyebrow="MCP SERVER" title="Katalog nástrojů" description="Stabilní názvy nástrojů s jasným stavem ověření a rizikovostí." /><div className="notice warning"><span>!</span><div><strong>Aktuální TTA nástroje jsou pouze pro čtení.</strong><p>Joby a aktivity volají endpointy popsané v REST Swaggeru. Názvy query musí existovat v TotalAgility. Zápis, dokumenty, uživatelé a Designer nejsou vystavené.</p></div></div><section className="tool-grid">{tools.map((tool) => <article className="tool-card" key={tool.name}><div className="tool-card-top"><span className={`tool-icon ${tool.status === "AVAILABLE" ? "tool-ready" : "tool-pending"}`}>{tool.status === "AVAILABLE" ? "◇" : "⋯"}</span><span className={`status-pill ${tool.status === "AVAILABLE" ? "status-green" : "status-neutral"}`}>{tool.status === "AVAILABLE" ? "Dostupný" : "Neimplementováno"}</span></div><h3><code>{tool.name}</code></h3><p>{tool.text}</p><div className="tool-meta"><span>{tool.area}</span><span className="risk-chip">{tool.risk}</span></div></article>)}</section><div className="info-banner"><span className="info-symbol">i</span><div><strong>API se volá pod nastaveným TTA účtem.</strong><p>MCP token omezuje připojení; TTA sama kontroluje oprávnění uživatele pro jednotlivé metody. Heslo ani session ID se klientovi nevrací.</p></div></div></>;
}

function AuditPage({ events }: { events: AuditEvent[] }) {
  return <><PageTitle eyebrow="DOHLED" title="Auditní záznamy" description="Přehled přihlášení, změn konfigurace a použití MCP nástrojů." /><section className="panel table-panel"><div className="panel-heading"><div><h2>Události <span className="count-pill">{events.length}</span></h2><p>Citlivé hodnoty nejsou do auditu ani logů zapisovány.</p></div></div>{events.length === 0 ? <EmptyState icon="≋" title="Audit je zatím prázdný" text="Události se zobrazí po přihlášení nebo změně konfigurace." /> : <div className="table-scroll"><table><thead><tr><th>ČAS</th><th>AKTÉR</th><th>AKCE</th><th>CÍL</th><th>VÝSLEDEK</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{date(event.createdAt)}</td><td>{event.actor}</td><td>{humanAction(event.action)}</td><td><span className="mono-url">{event.target ?? "—"}</span></td><td><span className={`status-pill ${event.result === "SUCCESS" || event.result === "REACHABLE" ? "status-green" : "status-neutral"}`}>{event.result}</span></td></tr>)}</tbody></table></div>}</section></>;
}

function SettingsPage({ user }: { user: User }) {
  return <><PageTitle eyebrow="KONFIGURACE" title="Nastavení" description="Základní informace o provozním režimu této instance." /><div className="settings-grid"><section className="panel setting-card"><div className="setting-icon">◈</div><div><h2>Úložiště a tajemství</h2><p>SQLite databáze mimo zdrojový repozitář. Hesla účtů používají Argon2id; TTA hesla a SYSTEM_SESSION_ID se šifrují AES-256-GCM.</p><span className="setting-state"><i /> Klíč načten z runtime secretu</span></div></section><section className="panel setting-card"><div className="setting-icon">◎</div><div><h2>Správce</h2><p>{user.username}<br />System Administrator</p><span className="setting-state"><i /> Aktivní účet</span></div></section><section className="panel setting-card"><div className="setting-icon">⌁</div><div><h2>Provozní omezení</h2><p>Výchozí bind pouze na loopbacku. Vzdálený provoz vyžaduje HTTPS reverse proxy a veřejný origin.</p><span className="setting-state"><i /> HTTP server 0.2.2</span></div></section><section className="panel setting-card"><div className="setting-icon">◇</div><div><h2>Stav ověření TTA</h2><p>Test ověřuje přihlášení přes REST API a platnost TTA relace; job a activity read operace jsou k dispozici jako MCP nástroje.</p><span className="setting-state waiting"><i /> Stav po posledním testu připojení</span></div></section></div><div className="info-banner"><span className="info-symbol">i</span><div><strong>Změnu síťových a databázových parametrů provádějte v chráněné konfiguraci služby.</strong><p>Nevkládejte hesla, SYSTEM_SESSION_ID ani šifrovací klíče do `.env`, repozitáře, příkazové historie nebo logů.</p></div></div></>;
}

function ConnectionDialog({ initial, onClose, onSave, busy }: { initial: Connection | null; onClose: () => void; onSave: (form: Record<string, unknown>) => void; busy: boolean }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "https://");
  const [deploymentType, setDeploymentType] = useState<"ON_PREMISE" | "CLOUD">(initial?.deploymentType ?? "ON_PREMISE");
  const [version, setVersion] = useState(initial?.version ?? "");
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs ?? 10000);
  const [apiPath, setApiPath] = useState(initial?.apiPath ?? "/services/sdk/v1");
  const [authMode, setAuthMode] = useState<"PASSWORD" | "SYSTEM_SESSION_ID">(initial?.authMode ?? "PASSWORD");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [clearCredentials, setClearCredentials] = useState(false);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const credentials = username && secret ? authMode === "PASSWORD" ? { username, secret } : { username, systemSessionId: secret } : undefined;
    onSave({ name, baseUrl, deploymentType, version, timeoutMs, apiPath, authMode, enabled: true, ...(credentials ? { credentials } : {}), ...(clearCredentials ? { clearCredentials: true } : {}) });
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal wide-modal" onSubmit={submit}>
      <div className="modal-head"><div><div className="eyebrow">{initial ? "UPRAVIT PROSTŘEDÍ" : "NOVÉ PROSTŘEDÍ"}</div><h2>{initial ? "TTA připojení" : "Přidat TTA připojení"}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div>
      <div className="form-grid">
        <label>Název prostředí<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="např. Výroba" /></label>
        <label>Typ prostředí<select value={deploymentType} onChange={(e) => setDeploymentType(e.target.value as "ON_PREMISE" | "CLOUD")}><option value="ON_PREMISE">On-premise</option><option value="CLOUD">Cloud</option></select></label>
        <label className="span-two">Základní URL<input required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://tenant.totalagility.com" /><small>Zadejte adresu instance; případný kontext jako /TotalAgility patří do této adresy.</small></label>
        <label>Cesta REST API<input required value={apiPath} onChange={(e) => setApiPath(e.target.value)} placeholder="/services/sdk/v1" /><small>Výchozí cesta z TTA Swaggeru je /services/sdk/v1; kontext /TotalAgility patří do základní URL.</small></label>
        <label>Verze (nepovinná)<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="např. 2026.3" /></label>
        <label>Timeout testu<select value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))}><option value={5000}>5 sekund</option><option value={10000}>10 sekund</option><option value={20000}>20 sekund</option><option value={30000}>30 sekund</option><option value={60000}>60 sekund</option></select></label>
      </div>
      <div className="credential-box"><div className="credential-icon">◈</div><div className="credential-content"><strong>{initial?.credentialsStored ? "Tajné údaje jsou šifrované" : "Autentizace TotalAgility"}</strong><p>TTA secrets se šifrují AES-256-GCM. Ponechte tajný údaj prázdný, chcete-li zachovat uloženou hodnotu.</p>{initial?.credentialsStored && <label className="check-row clear-row"><input type="checkbox" checked={clearCredentials} onChange={(e) => setClearCredentials(e.target.checked)} /><span><strong>Odstranit uložené údaje</strong></span></label>}</div></div>
      <div className="form-grid credential-fields">
        <label>Způsob autentizace<select value={authMode} onChange={(e) => setAuthMode(e.target.value as "PASSWORD" | "SYSTEM_SESSION_ID")}><option value="PASSWORD">Interní uživatel a heslo</option><option value="SYSTEM_SESSION_ID">SYSTEM_SESSION_ID (SSO)</option></select></label>
        <label>Uživatelské jméno<input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={initial?.credentialsStored ? "Ponechat beze změny" : ""} /></label>
        <label className="span-two">{authMode === "PASSWORD" ? "Heslo TTA" : "SYSTEM_SESSION_ID"}<input autoComplete="new-password" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={initial?.credentialsStored ? "Ponechat beze změny" : ""} /><small>Hodnota se znovu nezobrazuje a neposílá se do výstupu MCP.</small></label>
      </div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Zrušit</button><button className="button primary" disabled={busy}>{busy ? "Ukládám…" : "Uložit připojení"}</button></div>
    </form>
  </div>;
}
function TokenCreatedModal({ token, onClose }: { token: { id: string; name: string; secret: string; connectionIds: string[]; expiresAt: string | null }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(token.secret); setCopied(true); };
  return <div className="modal-backdrop"><section className="modal token-modal"><div className="success-seal">✓</div><div className="eyebrow centered">PŘÍSTUP VYTVOŘEN</div><h2>Uložte si token</h2><p className="modal-intro">Tento token se z bezpečnostních důvodů zobrazí pouze nyní. Zkopírujte jej do správce tajemství klienta.</p><div className="secret-box"><code>{token.secret}</code><button className="copy-button" onClick={() => void copy()}>{copied ? "Zkopírováno" : "Kopírovat"}</button></div><div className="token-scope"><strong>Rozsah přístupu</strong><span>{token.connectionIds.length} TTA prostředí</span><span>Vyprší {token.expiresAt ? date(token.expiresAt) : "bez expirace"}</span></div><div className="notice warning compact"><span>!</span><div><strong>Token nelze znovu zobrazit.</strong><p>Pokud jej ztratíte, zneplatněte ho a vytvořte nový.</p></div></div><div className="modal-actions"><button className="button primary full-width" onClick={onClose}>Hotovo</button></div></section></div>;
}

function SetupScreen({ state, refresh, onSetup }: { state: { setupCode: string | null; expiresAt: string | null; localOnly: boolean }; refresh: () => Promise<void>; onSetup: (code: string, username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(""); if (password !== confirm) { setError("Hesla se neshodují."); return; } if (!state.setupCode) { setError("Instalační kód není dostupný. Použijte lokální přístup přes SSH tunel."); return; } setBusy(true); try { await onSetup(state.setupCode, username, password); } catch (e) { setError(e instanceof Error ? e.message : "Prvního správce se nepodařilo vytvořit."); } finally { setBusy(false); } };
  return <div className="auth-layout"><div className="auth-visual"><div className="auth-glow" /><div className="auth-brand"><div className="brand-mark">T</div><div><strong>TTA MCP</strong><span>SERVER CONSOLE</span></div></div><div className="auth-message"><span className="eyebrow">BEZPEČNÁ SPRÁVA PROSTŘEDÍ</span><h1>Propojte TotalAgility<br />s vaším MCP klientem.</h1><p>Centrální správa připojení, přístupů a diagnostiky na jednom místě.</p><div className="auth-feature"><span>✓</span> Přihlašovací údaje šifrované při uložení</div><div className="auth-feature"><span>✓</span> Přístup klientů omezený na prostředí</div><div className="auth-feature"><span>✓</span> Audit změn a MCP požadavků</div></div><div className="auth-footer">TTA MCP Server <span>·</span> První spuštění</div></div><div className="auth-form-side"><form className="auth-card setup-card" onSubmit={submit}><div className="setup-illustration">✦</div><div className="eyebrow">PRVNÍ SPUŠTĚNÍ</div><h2>Vytvořte správce</h2><p className="auth-subtitle">Nastavte první účet. Přístupový kód je dostupný pouze z lokálního počítače a po dokončení se zneplatní.</p>{!state.setupCode && <div className="notice warning compact"><span>!</span><div><strong>{state.localOnly ? "Otevřete lokální adresu" : "Instalační kód vypršel"}</strong><p>{state.localOnly ? "Na VM použijte SSH tunel na port 8380 a otevřete http://127.0.0.1:8380." : "Obnovte stránku nebo restartujte server pro nový kód."}</p><button type="button" className="text-button" onClick={() => void refresh()}>Znovu načíst stav</button></div></div>}{state.setupCode && <div className="setup-code-box"><span>JEDNORÁZOVÝ INSTALAČNÍ KÓD</span><code>{state.setupCode}</code><small>Platnost do {date(state.expiresAt)}</small></div>}<label>Uživatelské jméno<input autoComplete="username" required minLength={3} maxLength={80} value={username} onChange={(e) => setUsername(e.target.value)} /></label><label>Heslo správce<input autoComplete="new-password" required type="password" minLength={12} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Alespoň 12 znaků" /></label><label>Potvrdit heslo<input autoComplete="new-password" required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>{error && <div className="form-error">{error}</div>}<button className="button primary full-width" disabled={busy || !state.setupCode}>{busy ? "Vytvářím účet…" : "Vytvořit účet správce"}</button><div className="auth-security-note"><span>◈</span> Heslo se ukládá jako Argon2id hash.</div></form><div className="auth-legal">Přístup pouze pro správce systému</div></div></div>;
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await onLogin(username, password); } catch (e) { setError(e instanceof Error ? e.message : "Přihlášení se nezdařilo."); } finally { setBusy(false); } };
  return <div className="auth-layout"><div className="auth-visual"><div className="auth-glow" /><div className="auth-brand"><div className="brand-mark">T</div><div><strong>TTA MCP</strong><span>SERVER CONSOLE</span></div></div><div className="auth-message"><span className="eyebrow">BEZPEČNÁ SPRÁVA PROSTŘEDÍ</span><h1>Propojte TotalAgility<br />s vaším MCP klientem.</h1><p>Centrální správa připojení, přístupů a diagnostiky na jednom místě.</p><div className="auth-feature"><span>✓</span> Přihlašovací údaje šifrované při uložení</div><div className="auth-feature"><span>✓</span> Přístup klientů omezený na prostředí</div><div className="auth-feature"><span>✓</span> Audit změn a MCP požadavků</div></div><div className="auth-footer">TTA MCP Server <span>·</span> Verze 0.2.2</div></div><div className="auth-form-side"><form className="auth-card" onSubmit={submit}><div className="login-icon">↗</div><div className="eyebrow">VÍTEJTE ZPĚT</div><h2>Přihlášení správce</h2><p className="auth-subtitle">Přihlaste se do konzole TTA MCP Serveru.</p><label>Uživatelské jméno<input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></label><label>Heslo<input autoComplete="current-password" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <div className="form-error">{error}</div>}<button className="button primary full-width" disabled={busy}>{busy ? "Přihlašuji…" : "Přihlásit se"}</button><div className="auth-security-note"><span>◈</span> Zabezpečená administrátorská relace</div></form><div className="auth-legal">TTA MCP Server · Lokální konzole</div></div></div>;
}

function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>; }
function StatusBadge({ status }: { status: string | null }) { const value = status ?? "NOT_TESTED"; const good = value === "API_COMPATIBLE"; const auth = value === "AUTH_REQUIRED"; const bad = ["AUTH_REJECTED", "SDK_UNAVAILABLE", "UNREACHABLE"].includes(value); return <span className={`status-pill ${good ? "status-green" : auth ? "status-amber" : bad ? "status-red" : "status-neutral"}`}><i />{good ? "API ověřeno" : auth ? "Chybí autentizace" : value === "AUTH_REJECTED" ? "Autentizace odmítnuta" : value === "SDK_UNAVAILABLE" ? "REST API endpoint nenalezen" : value === "UNREACHABLE" ? "Nedostupný" : "Netestováno"}</span>; }
function humanAction(action: string) { return ({ "auth.setup.complete": "Dokončeno první nastavení", "auth.login": "Přihlášení správce", "tta.connection.create": "Přidáno TTA připojení", "tta.connection.update": "Upraveno TTA připojení", "tta.connection.delete": "Odebráno TTA připojení", "tta.connection.test": "Test připojení", "mcp.token.create": "Vytvořen MCP token", "mcp.token.revoke": "Zneplatněn MCP token" } as Record<string,string>)[action] ?? action; }
function relativeDate(value: string) { const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000); if (minutes < 1) return "právě teď"; if (minutes < 60) return `před ${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `před ${hours} h`; return date(value); }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
