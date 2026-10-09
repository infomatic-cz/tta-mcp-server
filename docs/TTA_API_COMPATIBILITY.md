# TTA API kompatibilita

Tento dokument odlišuje doložené informace z dokumentace od ověření běžící instalace. Verze v tabulce nejsou tímto projektem proti TTA serveru testované.

| Produkt/verze | API zdroj | Stav v 0.1.2 |
|---|---|---|
| TotalAgility 8.0 | [Release notes 8.0 – RESTful service](https://docshield.tungstenautomation.com/KTA/en_US/8.0.0-ivy45l9g96/help/ReleaseNotes8.0.0/TotalAgility_releasenotes/c_restfulservice.html) | Dokumentace říká, že REST API je dostupné přes Designer a autentizace používá Session ID. Běhově neověřeno. |
| TotalAgility 8.1 | [REST API v Designeru](https://docshield.tungstenautomation.com/KTA/en_US/8.1.0-rmx0b1ux3q/help/Designer/All_Shared/Integration/c_sysrestapi.html) | Swagger dokumentace je vystavená přes Integration → TotalAgility Rest API. Běhově neověřeno. |
| TotalAgility 2025.2 | [SDK dokumentace](https://docshield.tungstenautomation.com/TotalAgility/en_US/2025.2-b103T2xQ9l/help/SDK_Documentation/latest/index.html) | SDK uvádí HTTP SOAP XML a HTTP JSON; SDK JSON používá POST a dokumentované služby/metody. Běhově neověřeno. |
| TotalAgility 2026.1 | [SDK dokumentace](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.1-sy4i5uG9Tu/help/SDK_Documentation/latest/index.html) | Dokumentace uvádí podporované metody a HTTP JSON/SOAP služby. Běhově neověřeno. |
| TotalAgility 2026.3 | [SDK dokumentace](https://docshield.tungstenautomation.com/TotalAgility/en_US/2026.3-xw9na1myhb/help/SDK_Documentation/latest/index.html) | Dokumentace uvádí služby SDK a jejich metody. Běhově neověřeno. |
| 2026.2, 2026.4+ | Zdroje je nutné doplnit | Neověřeno. |

## Doložené detaily

- Oficiální SDK dokumentace 2026.1 popisuje HTTP SOAP XML a HTTP JSON. HTTP JSON používá POST s JSON payloadem a podobné služby/metody jako SOAP.
- Oficiální API dokumentace označuje jako podporované pouze metody, které dokumentuje. Nezdokumentované endpointy se nesmí použít jako náhrada.
- Verze 8.0 dokumentuje REST API přes Swagger a uvádí Session ID v `Authorization` hlavičce.
- Adresa SDK služeb se konfiguruje podle dané instalace, cloud/on-premise režimu a autentizace. Nelze předpokládat jednotný URL pattern pro všechny verze.

## Implementováno v tomto releasu

Není implementována žádná TTA SDK, REST ani SOAP metoda. Test připojení je obecný HTTP GET bez credentials. Stav capability `endpoint.reachability` není důkazem dostupnosti TTA funkcí. Každá capability zůstává `NOT_TESTED`.

Před implementací další etapy je nutné získat přístup k oficiální SDK/REST dokumentaci konkrétní instalace, sestavit tabulku metod/auth/URL pro cílové verze a otestovat bezpečné čtecí volání na skutečném TTA testovacím prostředí.
