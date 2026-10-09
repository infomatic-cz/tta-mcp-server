# TTA MCP Server
## Technické zadání vývoje – verze 1.0

**Produkt:** Tungsten TotalAgility MCP Server  
**Cíl:** Univerzální, víceuživatelský a víceinstanční MCP server pro provozní ovládání, vývoj a administraci Tungsten TotalAgility  
**Technologie:** Node.js, TypeScript, React, Vite  
**Cílové platformy:** Windows, Linux, Docker  
**Režimy:** Lokální, serverový, víceuživatelský

---

# 1. Cíl projektu

Vyvinout plnohodnotný MCP (Model Context Protocol) server pro integraci AI asistentů s platformou Tungsten TotalAgility (TTA).

Řešení musí umožňovat:

- Připojení libovolného počtu instalací TTA
- Současnou práci s různými verzemi TTA
- Provozní správu procesů, úloh, dokumentů a uživatelů
- Vývojovou práci s definicemi procesů, formuláři a konfigurací
- Administraci TTA prostřednictvím dostupných oficiálních API
- Připojení AI klientů prostřednictvím MCP
- Grafickou správu všech připojení a konfigurací
- Centrální správu uživatelů, rolí a oprávnění
- Bezpečný lokální i vzdálený provoz
- Auditování všech operací
- Automatické rozpoznávání dostupných schopností připojených instalací

Řešení musí být koncipováno jako samostatná aplikace, nikoli jako rozšíření vyžadující instalaci přímo do TTA.

# 2. Podporované verze TotalAgility

Požadované verze:

- TotalAgility 8.0
- TotalAgility 8.1
- TotalAgility 2025.2
- TotalAgility 2026.1
- TotalAgility 2026.2
- TotalAgility 2026.3
- TotalAgility 2026.4 – připravenost na budoucí podporu
- Novější verze bez nutnosti zásadního přepracování aplikace

## 2.1 Princip kompatibility

Implementovat vrstvu adaptérů oddělující MCP nástroje od konkrétních TTA API.

Každý adaptér musí deklarovat:

- Podporované verze
- Dostupné API služby
- Podporované metody
- Rozdíly v parametrech
- Rozdíly v návratových hodnotách
- Požadavky na autentizaci
- Omezení konkrétní verze
- Dostupnost operací pro on-premise a cloud

Nepoužívat pevně zakódovanou logiku konkrétní verze napříč aplikací.

Zavést společné rozhraní `TtaAdapter` a specializované adaptéry.

Navrhovaná struktura:

```text
adapters/
  common/
  tta-8/
  tta-2025/
  tta-2026/
  future/
```

Rozdělení adresářů je orientační. Pokud dvě verze používají stejné API kontrakty, musí sdílet implementaci.

## 2.2 Detekce schopností

Při přidání serveru provést:

1. Ověření dostupnosti TTA
2. Zjištění verze, pokud to API umožňuje
3. Ověření dostupných API endpointů
4. Identifikaci způsobu autentizace
5. Zjištění dostupných služeb a metod
6. Vytvoření profilu schopností instalace
7. Uložení výsledků diagnostiky

Použít capability registry, například:

```text
process.read
process.start
process.design.read
process.design.write
job.read
job.suspend
job.resume
job.terminate
activity.read
activity.complete
document.read
document.write
form.design.read
form.design.write
user.read
system.read
```

Schopnosti nesmí být považovány za dostupné pouze na základě čísla verze. Musí vycházet z dokumentace a ověřených vlastností připojení.

Rozlišovat stavy `SUPPORTED`, `UNSUPPORTED`, `UNKNOWN`, `NOT_AUTHORIZED` a `NOT_TESTED`.

Pokud není verze rozpoznána, použít kompatibilní adaptér pouze tehdy, pokud lze jeho použití bezpečně ověřit.

# 3. Architektura

## 3.1 Technologie

Backend:

- Node.js v podporované LTS verzi
- TypeScript v přísném režimu
- Fastify pro HTTP API
- Oficiální MCP TypeScript SDK
- Zod pro validaci vstupů
- Pino pro strukturované logování
- Prisma nebo Drizzle pro databázovou vrstvu

Frontend:

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- TanStack Table
- Lucide React
- Jednotná sada UI komponent

Databáze:

- SQLite pro lokální instalace
- PostgreSQL pro centrální instalace
- Migrace databázového schématu
- Stejný logický datový model v obou režimech

Preferovat jednu databázovou vrstvu s podporou obou databází. Pokud zvolený ORM vyžaduje rozdílná schémata, minimalizovat jejich duplicitu.

## 3.2 Architektonické vrstvy

```text
AI CLIENTS
    |
    | MCP
    v
MCP TRANSPORT
    |
    v
TOOL REGISTRY
    |
    v
AUTHORIZATION
    |
    v
TTA SERVICE LAYER
    |
    v
CAPABILITY REGISTRY
    |
    v
VERSION ADAPTERS
    |
    v
REST / SDK JSON / SOAP
    |
    v
TUNGSTEN TOTALAGILITY
```

Administrace:

```text
REACT ADMIN UI
    |
    v
ADMIN REST API
    |
    v
APPLICATION SERVICES
    |
    +-- Connection Management
    +-- User Management
    +-- Access Control
    +-- Capability Registry
    +-- Monitoring
    +-- Audit
    +-- Configuration
```

MCP a administrační API musí využívat společnou aplikační logiku. Nesmí vzniknout dvě nezávislé implementace komunikace s TTA.

# 4. Správa připojení k TTA

## 4.1 Evidence serverů

Webové rozhraní musí umožňovat:

- Přidání nového TTA serveru
- Úpravu konfigurace
- Deaktivaci serveru
- Odstranění serveru
- Test dostupnosti
- Test autentizace
- Zobrazení verze TTA
- Zobrazení podporovaných funkcí
- Zobrazení diagnostiky připojení
- Ruční obnovení capability profilu

Každé připojení musí obsahovat:

| Parametr | Popis |
|---|---|
| ID | Jednoznačný interní identifikátor |
| Název | Uživatelský název |
| URL | Základní adresa instalace |
| Typ | On-premise / Cloud |
| Verze | Detekovaná nebo ručně nastavená |
| Adaptér | Automatický nebo ručně vybraný |
| Autentizace | Podporovaný způsob přihlášení |
| Stav | Aktivní / Neaktivní |
| Timeout | Časový limit požadavků |
| TLS | Konfigurace důvěryhodných certifikátů |
| Oprávnění | Povolené operace a role |

Přihlašovací údaje ukládat odděleně a šifrovaně.

## 4.2 Autentizace vůči TTA

Implementovat rozšiřitelné poskytovatele autentizace.

Podporovat metody skutečně dostupné v jednotlivých API:

- Uživatelské přihlášení a SDK session
- OAuth, pokud je konkrétním API podporován
- Integrovanou Windows autentizaci, pokud ji vyžaduje daná instalace a lze ji bezpečně realizovat
- Další metody podle oficiální dokumentace

Nezaměňovat MCP autentizaci s autentizací TTA.

Zajistit správu životního cyklu session, obnovování přihlášení, bezpečné ukončování session a izolaci jednotlivých připojení.

Nepředpokládat, že jedna autentizační metoda funguje pro všechna API.

## 4.3 Test připojení

Po stisknutí tlačítka „Testovat připojení“ zobrazit:

- Dostupnost serveru
- Výsledek TLS ověření
- Výsledek autentizace
- Detekovanou verzi
- Dostupné API služby
- Vybraný adaptér
- Počet ověřených schopností
- Chyby a doporučení k odstranění problému

Testy musí být bezpečné a nesmí vytvářet ani měnit provozní data.

# 5. MCP server

## 5.1 Podporované transporty

Implementovat:

**stdio**

Pro lokální použití s Codexem a dalšími MCP klienty.

**Streamable HTTP**

Pro centrální serverový provoz.

Použít aktuální podporovanou specifikaci MCP.

Zajistit správné zpracování inicializace, ukončování spojení, chyb, časových limitů a případných session.

## 5.2 MCP Tools

Nástroje rozdělit do domén:

```text
tta_connection_*
tta_system_*
tta_process_*
tta_job_*
tta_activity_*
tta_document_*
tta_user_*
tta_group_*
tta_form_*
tta_design_*
tta_administration_*
```

Každý nástroj musí mít:

- Jednoznačný název
- Popis pro AI klienta
- Validované vstupní schéma
- Standardizované výstupní schéma
- Deklarovanou požadovanou schopnost TTA
- Deklarované oprávnění
- Klasifikaci rizika
- Auditní záznam
- Standardizované chybové odpovědi

Názvy nástrojů musí být stabilní bez ohledu na verzi TTA.

## 5.3 Kontext připojení

Každá operace musí být svázána s konkrétním TTA prostředím.

AI klient nesmí získat přístup k jinému prostředí pouze změnou parametru `connectionId`.

Server musí při každém požadavku ověřit, zda má volající oprávnění k danému připojení i operaci.

Uživatel může mít přístup k více instalacím, ale každá instalace musí mít samostatnou autorizaci.

## 5.4 MCP Resources

Implementovat zdroje pro čtení vhodných informací, například:

- Přehled dostupných připojení
- Informace o instalaci TTA
- Podporované schopnosti
- Dokumentaci nástrojů
- Metadatové informace o procesech
- Dostupné procesní definice

Zdroje musí respektovat stejná oprávnění jako nástroje.

## 5.5 MCP Prompts

Připravit volitelné pracovní šablony:

- Analýza chybových procesů
- Diagnostika konkrétní instance
- Analýza procesní definice
- Analýza výkonnosti procesu
- Kontrola konfigurace instalace
- Návrh optimalizace procesu

Prompty nesmí obcházet oprávnění ani automaticky provádět destruktivní operace.

# 6. Provozní správa TotalAgility

Implementovat samostatné skupiny nástrojů.

## 6.1 Procesní definice

Cílové operace:

- Vyhledávání dostupných procesů
- Získání detailu procesní definice
- Získání dostupných verzí
- Zjištění publikovaného stavu
- Získání informací o aktivitách
- Získání definovaných proměnných

Rozlišovat mezi procesní definicí a běžící instancí procesu.

## 6.2 Instance procesů

Cílové operace:

- Vyhledávání instancí
- Filtrování podle stavu, procesu a času
- Získání detailu instance
- Získání historie
- Získání chybových informací
- Spuštění nové instance
- Pozastavení a obnovení instance
- Ukončení instance, pokud API podporuje příslušnou operaci

Destruktivní operace musí vyžadovat zvýšené oprávnění a potvrzení.

## 6.3 Aktivity a úlohy

Cílové operace:

- Vyhledávání aktivit
- Získání detailu aktivity
- Získání přiřazeného uživatele
- Získání termínů a SLA
- Získání dostupných akcí
- Přiřazení aktivity
- Dokončení aktivity
- Diagnostika chybových aktivit

Vstupy pro dokončení aktivit validovat podle skutečných požadavků TTA.

## 6.4 Procesní proměnné

Cílové operace:

- Získání seznamu proměnných
- Získání typu a hodnoty
- Změna hodnoty, pokud je podporována
- Validace datových typů
- Ochrana citlivých hodnot

Nesmí docházet k automatickému zveřejňování hesel, tokenů a dalších citlivých údajů.

## 6.5 Dokumenty

Cílové operace:

- Vyhledávání dokumentů
- Získání metadat
- Získání obsahu dokumentu
- Práce s dokumenty konkrétní instance
- Přidání dokumentu
- Aktualizace metadat
- Získání dostupných klasifikačních informací

Binární dokumenty nepředávat automaticky do kontextu AI. Zavést řízené stahování, omezení velikosti a kontrolu oprávnění.

# 7. Vývoj a Designer

Tato oblast je strategicky důležitá.

Cílem je umožnit AI asistentům analyzovat a tam, kde to oficiální rozhraní dovoluje, také upravovat návrhové objekty TotalAgility.

## 7.1 Analýza definic

Požadované schopnosti:

- Získání struktury procesu
- Získání seznamu aktivit
- Získání přechodů mezi aktivitami
- Získání proměnných
- Získání pravidel a podmínek
- Získání integračních konfigurací
- Analýza formulářů a jejich vazeb

## 7.2 Úpravy návrhových objektů

Prověřit a podle skutečně dostupných API implementovat:

- Vytváření procesních definic
- Úpravy aktivit
- Úpravy proměnných
- Úpravy přechodů
- Vytváření a úpravy formulářů
- Práci s business rules
- Práci s integračními objekty
- Validaci a publikování změn

Neimplementovat neoficiální zásahy do databáze TTA jako náhradu za chybějící API.

Pokud není operace podporována, nástroj musí tuto skutečnost jednoznačně sdělit.

## 7.3 Export a import

Prověřit podporované mechanismy:

- Export procesních definic
- Export balíčků
- Import balíčků
- Validace importovaných objektů
- Porovnání konfigurací mezi prostředími

Při přenosu mezi instalacemi kontrolovat kompatibilitu verzí a závislosti.

## 7.4 Bezpečnost vývojových operací

Zavést oddělená oprávnění pro:

- Čtení definic
- Návrh změn
- Provádění změn
- Publikování
- Import a nasazení

Pokud API dovoluje transakční nebo návrhový režim, využít jej.

Změny musí být auditovatelné a před provedením musí být možné zobrazit jejich rozsah.

# 8. Administrace TotalAgility

Prověřit a implementovat dostupné funkce:

- Vyhledávání uživatelů
- Vyhledávání skupin
- Získání organizačních informací
- Čtení oprávnění
- Získání systémových informací
- Diagnostika konfigurace
- Zjištění dostupných služeb

Zápisové administrátorské operace implementovat až po ověření oficiální podpory.

MCP server nesmí obcházet bezpečnostní model TTA.

# 9. Webové administrační rozhraní

Vytvořit plnohodnotné responzivní administrační GUI.

## 9.1 Navigace

Navrhované sekce:

```text
Dashboard
Připojení k TotalAgility
MCP klienti
Uživatelé
Role a oprávnění
MCP nástroje
Monitoring
Audit
Nastavení
```

## 9.2 Dashboard

Zobrazovat:

- Počet registrovaných TTA serverů
- Počet dostupných serverů
- Počet nedostupných serverů
- Počet aktivních MCP klientů, pokud lze stav spolehlivě zjistit
- Počet MCP požadavků
- Počet úspěšných a chybných požadavků
- Průměrnou dobu odezvy
- Poslední chyby

## 9.3 Připojení

Tabulkový přehled s filtrováním, řazením a stránkováním.

Detail připojení rozdělit na záložky:

- Obecné
- Autentizace
- API a schopnosti
- Oprávnění
- Diagnostika
- Historie

U každého připojení zobrazovat detekovanou verzi a stav kompatibility.

## 9.4 MCP nástroje

Zobrazit katalog všech dostupných nástrojů.

U každého nástroje uvést:

- Název
- Popis
- Oblast
- Rizikovost
- Požadované oprávnění
- Dostupnost podle TTA připojení
- Možnost administrátorského povolení nebo zakázání

Přidat testovací konzoli, ve které lze nástroj spustit s validovanými parametry.

Zápisové operace musí mít potvrzovací mechanismus.

## 9.5 Správa uživatelů

Podporovat:

- Vytvoření uživatele
- Změnu uživatele
- Deaktivaci uživatele
- Přiřazení rolí
- Přiřazení dostupných TTA prostředí
- Správu MCP přístupů
- Zobrazení historie aktivit

## 9.6 Správa MCP klientů

Evidovat MCP klienty a jejich přístupy.

Zajistit:

- Vytváření přístupových oprávnění
- Revokaci přístupů
- Omezení na konkrétní TTA prostředí
- Omezení dostupných nástrojů
- Expiraci přístupů
- Zobrazení posledního použití

Pro vzdálený provoz preferovat standardní OAuth autentizaci MCP. Samostatné API tokeny mohou být podporovány pro řízené interní scénáře, nesmí však nahrazovat bezpečnostní model víceuživatelského provozu.

# 10. Oprávnění a bezpečnost

## 10.1 RBAC

Implementovat role:

- System Administrator
- TTA Administrator
- Developer
- Operator
- Reader

Role musí být upravitelné.

Oprávnění musí být definována na úrovni:

1. Uživatele nebo klienta
2. TTA připojení
3. Skupiny nástrojů
4. Konkrétní operace

Používat princip minimálních oprávnění.

## 10.2 Rizikovost operací

Klasifikovat nástroje:

- READ – Pouze čtení
- WRITE – Změna dat
- ADMIN – Administrátorská operace
- DESTRUCTIVE – Nevratná nebo riziková operace

Rizikové operace musí vyžadovat odpovídající oprávnění a potvrzení.

U vzdálených MCP klientů nespoléhat výhradně na potvrzovací dialog klienta. Pro kritické operace implementovat serverově ověřitelný schvalovací mechanismus.

## 10.3 Ochrana přihlašovacích údajů

- Hesla uživatelů ukládat pomocí Argon2id
- Tajné údaje TTA šifrovat při uložení
- Šifrovací klíče neukládat společně s šifrovanými daty bez další ochrany
- Nikdy nezapisovat hesla a tokeny do logů
- Podporovat rotaci přihlašovacích údajů
- Umožnit bezpečnou správu certifikátů

## 10.4 Ochrana proti zneužití

Implementovat:

- Rate limiting
- Ochranu proti SSRF při konfiguraci TTA URL
- Kontrolu TLS certifikátů
- Ochranu proti CSRF v administračním GUI
- Bezpečné session cookies
- Kontrolu původu HTTP požadavků
- Omezení velikosti požadavků
- Časové limity
- Ochranu proti opakovanému provedení citlivých operací

Zejména zabránit tomu, aby AI klient mohl využít TTA MCP Server jako obecnou HTTP proxy do interní sítě.

# 11. Audit a monitoring

## 11.1 Audit

Auditovat:

- Přihlášení uživatele
- Změny konfigurace
- Přidání a odstranění TTA připojení
- Změny oprávnění
- Volání MCP nástrojů
- Zápisové a administrátorské operace
- Neúspěšné pokusy o přístup
- Chyby komunikace s TTA

Auditní záznam musí obsahovat:

- Čas
- Identitu uživatele nebo klienta
- TTA připojení
- Nástroj
- Typ operace
- Výsledek
- Dobu trvání
- Korelační identifikátor

Citlivé parametry anonymizovat nebo nezaznamenávat.

## 11.2 Monitoring

Implementovat:

- Health endpoint
- Readiness endpoint
- Metriky provozu
- Diagnostiku jednotlivých připojení
- Přehled chyb
- Přehled latencí

Výpadek jednoho TTA serveru nesmí způsobit nedostupnost celého MCP serveru.

# 12. Datový model

Minimální entity:

```text
User
Role
Permission
UserRole

TtaConnection
TtaCredential
TtaCapability
TtaConnectionCapability

McpClient
McpClientPermission

ToolDefinition
ToolPolicy

AuditEvent
ConnectionHealth
SystemSetting
```

Datový model musí podporovat více uživatelů a více TTA připojení.

Zavést migrace a integritní omezení.

Při mazání připojení řešit závislosti a zachování auditní historie.

# 13. Lokální a serverový režim

## 13.1 Lokální režim

Požadavky:

- Spuštění na Windows
- SQLite
- MCP přes stdio
- Lokální administrační GUI
- Minimální konfigurace
- Možnost automatického spuštění

Lokální režim musí podporovat více TTA připojení.

Ve výchozím nastavení musí být HTTP administrační rozhraní dostupné pouze na localhost.

## 13.2 Serverový režim

Požadavky:

- Linux a Windows
- PostgreSQL
- Streamable HTTP
- Víceuživatelský provoz
- HTTPS
- Centrální správa přístupů
- Provoz jako systémová služba

## 13.3 Docker

Připravit:

- Dockerfile
- Docker Compose
- Konfiguraci prostřednictvím proměnných prostředí
- Persistentní úložiště
- Healthcheck
- Dokumentaci aktualizace

Nepoužívat vývojový Vite server v produkčním prostředí.

Produkční React build poskytovat prostřednictvím backendu nebo reverzní proxy.

# 14. Testování

## 14.1 Automatické testy

Implementovat:

- Unit testy
- Integrační testy
- Testy MCP protokolu
- Testy autorizace
- Testy adaptérů
- Testy databázových migrací
- Testy administračního API
- E2E testy GUI

Použít Vitest a Playwright.

## 14.2 Mock TotalAgility

Vytvořit samostatný mock server simulující vybraná TTA API.

Musí umožňovat testovat:

- Úspěšné odpovědi
- Chybné přihlašovací údaje
- Nedostupný server
- Timeout
- Rozdílné verze API
- Nepodporované operace
- Chybové instance procesů

Mock nesmí být zaměňován za potvrzení kompatibility se skutečnou TTA.

## 14.3 Kompatibilita

Vytvořit testovací matici:

| Verze | API discovery | Čtení | Zápis | Designer |
|---|---|---|---|---|
| 8.0 | Ověřit | Ověřit | Ověřit | Ověřit |
| 8.1 | Ověřit | Ověřit | Ověřit | Ověřit |
| 2025.2 | Ověřit | Ověřit | Ověřit | Ověřit |
| 2026.1 | Ověřit | Ověřit | Ověřit | Ověřit |
| 2026.2 | Ověřit | Ověřit | Ověřit | Ověřit |
| 2026.3 | Ověřit | Ověřit | Ověřit | Ověřit |
| 2026.4+ | Připravenost | Neověřeno | Neověřeno | Neověřeno |

Každou verzi označit jako ověřenou pouze po úspěšném testování proti skutečné instalaci.

# 15. Implementační postup

Práci rozdělit do samostatně testovatelných etap.

## Etapa 0 – Analýza API

Nejprve:

1. Prostudovat oficiální dokumentaci TTA
2. Identifikovat REST, SDK JSON a SOAP služby
3. Vytvořit katalog dostupných metod
4. Namapovat metody na požadované MCP schopnosti
5. Identifikovat rozdíly mezi verzemi
6. Zdokumentovat nepodporované operace
7. Navrhnout konkrétní rozhraní adaptérů

Výstupem musí být `docs/TTA_API_COMPATIBILITY.md`.

U každé metody uvést zdroj dokumentace, podporované verze a stav ověření.

Nevymýšlet neexistující API metody.

## Etapa 1 – Technický základ

Implementovat:

- Strukturu projektu
- Backend
- React GUI
- Databázovou vrstvu
- MCP transporty
- Konfiguraci
- Logování
- Základní autentizaci
- Health endpointy

Výsledkem musí být spustitelná aplikace.

## Etapa 2 – Připojení TTA

Implementovat:

- CRUD připojení
- Bezpečnou správu přihlašovacích údajů
- Test připojení
- Adaptéry
- Capability registry
- Diagnostiku

## Etapa 3 – MCP nástroje pro čtení

Implementovat ověřené nástroje pro:

- Systémové informace
- Procesy
- Instance
- Aktivity
- Dokumenty
- Uživatele

## Etapa 4 – Provozní operace

Implementovat:

- Spouštění procesů
- Práci s aktivitami
- Změny podporovaných hodnot
- Další ověřené zápisové operace

Zavést potvrzování a audit.

## Etapa 5 – Designer a vývoj

Implementovat dostupné operace pro:

- Analýzu procesních definic
- Analýzu formulářů
- Export a import
- Úpravy návrhových objektů
- Publikování

Pouze tam, kde existuje podporované rozhraní.

## Etapa 6 – Produkční připravenost

Dokončit:

- RBAC
- Bezpečnostní testy
- Monitoring
- Docker
- Windows službu
- Linux systemd službu
- Instalační dokumentaci
- Zálohování a obnovu
- Upgrade databáze
- Testy kompatibility

# 16. Akceptační kritéria

Projekt bude považován za funkčně dokončený v rozsahu implementovaných a ověřených schopností, pokud:

1. Aplikaci lze spustit na Windows a Linuxu.
2. Funguje lokální i centrální režim.
3. Administrátor může přes GUI vytvořit více TTA připojení.
4. Každé připojení má nezávislou konfiguraci a autentizaci.
5. Server umí rozlišovat dostupné a nedostupné schopnosti.
6. MCP klient může bezpečně získávat informace z autorizované instalace.
7. Zápisové operace podléhají autorizaci a auditu.
8. Uživatel nemůže přistupovat k nepovoleným instalacím.
9. GUI umožňuje správu uživatelů, rolí a nástrojů.
10. Výpadek jedné TTA instalace neovlivní ostatní připojení.
11. Aplikace obsahuje automatické testy.
12. Dokumentace popisuje instalaci, konfiguraci a bezpečnost.
13. Kompatibilita jednotlivých verzí je doložena výsledky testů.
14. Novou verzi TTA lze podporovat přidáním nebo aktualizací adaptéru bez zásadního zásahu do MCP vrstvy.

# 17. Požadované výstupy

Vytvořit:

```text
README.md
CHANGELOG.md

docs/
  ARCHITECTURE.md
  INSTALLATION_WINDOWS.md
  INSTALLATION_LINUX.md
  INSTALLATION_DOCKER.md
  CONFIGURATION.md
  SECURITY.md
  MCP_CLIENT_SETUP.md
  TTA_API_COMPATIBILITY.md
  TTA_CAPABILITIES.md
  TEST_PLAN.md
  TEST_RESULTS.md

apps/
  server/
  web/

packages/
  core/
  mcp/
  tta-client/
  tta-adapters/
  shared/

tests/
  unit/
  integration/
  e2e/
  compatibility/
```

Strukturu lze upravit, pokud bude výsledné řešení přehlednější.

# 18. Zásady pro Codex

- Nejprve analyzuj existující projekt a dostupnou dokumentaci.
- Pokud projekt neexistuje, vytvoř nový repozitář s odpovídající strukturou.
- Používej skutečná a doložená API TotalAgility.
- Nevytvářej fiktivní integrace, které pouze vracejí ukázková data.
- Mock implementace musí být jednoznačně oddělené od produkčních.
- Nevytvářej duplicity v komunikaci s TTA.
- Dodržuj TypeScript strict mode.
- Implementuj průběžné automatické testování.
- Každou etapu dokonči do funkčního a ověřitelného stavu.
- Neoznačuj neotestované verze jako podporované.
- Neprováděj destruktivní operace proti reálným instalacím bez výslovného souhlasu.
- Nezapisuj přihlašovací údaje do zdrojových kódů ani logů.
- Dokumentuj zásadní architektonická rozhodnutí.
- Při nedostupnosti konkrétní API metody implementuj korektní informaci o nepodporované schopnosti, nikoli náhradní neověřený mechanismus.
- Zachovej oddělení transportní, aplikační, autorizační a integrační vrstvy.
- Upřednostňuj dlouhodobou udržovatelnost a kompatibilitu před rychlým vytvořením demonstrace.

**Požadovaný výsledek:** Produkčně použitelný, rozšiřitelný TTA MCP Server s webovou administrací, podporou více instalací TotalAgility, řízeným přístupem AI klientů a jasně zdokumentovanou kompatibilitou jednotlivých verzí.
