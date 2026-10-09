# Výsledky ověření

## 0.1.1 (2026-10-09)

- Čistý build `scripts/New-Build.ps1`: úspěšná TypeScript kompilace, Vite build a vytvoření release i Linux archivu v `C:\Temp\TTAMCP-Build`.
- Ruční smoke běžící aplikace: `/health/live` a `/health/ready` vrátily 200; administrační stránka 200; neautorizovaný `/tta-mcp` vrátil 401 s platným JSON tělem.
- První setup správce, login a vytvoření omezeného MCP tokenu proběhly úspěšně.
- MCP `initialize` (protocol `2025-03-26`), `tools/list` (oba nástroje) a `tools/call` pro `tta_connections_list` vrátily 200.
- Automatická testovací sada: zatím nebyla přidána; výše uvedené je ruční smoke, ne úplné regresní pokrytí.
- TTA instalace: proti skutečnému serveru nebyla testována.
- Kompatibilita TTA 8.0/8.1/2025.2/2026.x: neověřeno.
- Nasazení VM: skript a unit jsou připravené; první cílová VM nebyla ověřena.

Nezaměňovat úspěšný HTTP GET na hostu za potvrzení funkčního TTA API.
