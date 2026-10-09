# Instalace na Linux VM

Nasazovací skript vytváří systemd službu, ale nepřidává veřejný TLS terminátor. VM potřebuje podporovanou LTS verzi Ubuntu/Debian, systemd a `systemd-creds` 250+, Node.js 22/24 LTS v `/usr/bin/node`, `npm`, `openssl`, `tar`, `runuser`, `useradd`, `install` a SSH. Během nasazení musí mít VM odchozí HTTPS/DNS přístup k npm registry, protože produkční nativní závislosti se instalují přímo na cílovém Linuxu. Aplikace dále potřebuje síťovou cestu k TTA endpointům.

## Nasazení

Z Windows stanice:

```powershell
./Deploy-Server.ps1 -Server 'tta-mcp.example.cz' -User 'pavel' -PublicOrigin 'https://tta-mcp.example.cz'
```

Nasazovací uživatel potřebuje SSH klíč a neinteraktivní oprávnění `sudo` (`sudo -n`); při přihlášení jako `root` se sudo nepoužije. Skript sestaví artefakt v `C:\Temp\TTAMCP-Build`, odešle jej do `/tmp`, na VM nainstaluje produkční závislosti pro Linux, vytvoří účet `tta-mcp-server`, databázový adresář a službu `tta-mcp-server.service`. Na pracovní stanici musí být dostupné `ssh.exe` a `scp.exe`.

První vault klíč generuje přímo VM. `systemd-creds encrypt` jej zapíše v zašifrované podobě do `/etc/tta-mcp-server/vault-key.cred`; systemd zpřístupní odemčený credential pouze v runtime adresáři procesu. Klíč není v příkazových argumentech, unit souboru ani ve SQLite.

## První přihlášení na VM

Port aplikace je dostupný pouze na `127.0.0.1:8380`. Z pracovní stanice vytvořte SSH tunel:

```powershell
ssh -L 8380:127.0.0.1:8380 pavel@tta-mcp.example.cz
```

Otevřete `http://127.0.0.1:8380`, vytvořte prvního správce a odhlaste se. Setup kód není přístupný přes veřejnou doménu; setup API kontroluje lokální Host a socket.

Před zpřístupněním aplikace uživatelům nainstalujte TLS reverse proxy. Příklad Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name tta-mcp.example.cz;
    # ssl_certificate a ssl_certificate_key nastavte podle správce certifikátu.
    location / {
        proxy_pass http://127.0.0.1:8380;
        proxy_http_version 1.1;
        proxy_set_header Host tta-mcp.example.cz;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

Zajistěte, aby proxy přijímala pouze HTTPS, nepřeposílala podvržený `X-Forwarded-For` a měla `Host` nastavený na vaši doménu. Síťový firewall VM ponechte otevřený pro SSH a HTTPS reverse proxy; port 8380 není třeba zveřejnit. Poté nastavte `TTA_COOKIE_SECURE=true` v `/etc/tta-mcp-server/server.env` a proveďte `sudo systemctl restart tta-mcp-server`.

## Správa služby

```sh
sudo systemctl status tta-mcp-server
sudo journalctl -u tta-mcp-server -f
sudo systemctl restart tta-mcp-server
```

Logy neobsahují request body, cookie ani bearer tokeny. Nepovolujte přímý příchozí přístup na port 8380.

## Záloha a obnova

Zastavte službu a zálohujte `/var/lib/tta-mcp-server` i `/etc/tta-mcp-server/vault-key.cred`. Tyto položky musí být součástí stejného šifrovaného backup setu. Obnovení credential na jinou VM nemusí být možné, protože systemd-creds je vázán na host; před obnovou ověřte podporu host key/TPM, případně přidejte TTA tajemství znovu. Nikdy nezálohujte runtime credential directory.

## Ruční aktualizace

`Deploy-Server.ps1` vytvoří novou release složku a přepne symlink `current`; existující DB a systemd credential zůstávají na místě. Před aktualizací vytvořte zálohu. Automatické rollback databázového schématu není v 0.1.2 implementován.
