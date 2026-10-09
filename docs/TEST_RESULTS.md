# Výsledky ověření

## 0.2.0 (2026-10-09)

- `New-Build.ps1` úspěšně provedl TypeScript kompilaci a Vite produkční build v `C:\Temp\TTAMCP-Build`; vytvořil release a `tta-mcp-server-0.2.0.tgz`.
- Kompilace zahrnovala TTA SDK JSON autentizaci, read-only MCP operace a administrační UI.
- Skutečný TTA tenant nebyl z tohoto prostředí dostupný; cloudová URL, credentials, práva a jednotlivé SDK metody proto nebyly runtime ověřeny.
- Linux VM nebyla nasazena. Automatizovaná testovací sada v repozitáři zatím není.

## 0.1.2 (2026-10-09)

- `New-Build.ps1` z kořene projektu úspěšně dokončil TypeScript/Vite build a vytvořil release a Linux archiv v `C:\Temp\TTAMCP-Build`.
- `Run-Local.ps1` z kořene projektu spustil sestavenou verzi bez explicitního `TTA_PORT`; server naslouchal na `127.0.0.1:8380`.
- `/health/live` vrátil verzi 0.1.2 a stav `ok`; `/health/ready` vrátil stav `ready`.
- Linux VM ani skutečná TTA instalace nebyly v této změně ověřeny.

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
