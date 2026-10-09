# Docker

Docker image a Docker Compose deployment nejsou dodány. Pro VM použijte systemd postup v [INSTALLATION_LINUX.md](INSTALLATION_LINUX.md), který používá `LoadCredentialEncrypted` a drží aplikaci pouze na loopbacku.

Při budoucím Docker řešení musí image obsahovat pouze produkční build, SQLite musí být na persistentním volume a vault klíč musí přijít z Docker Swarm/Kubernetes secret store nebo externího secret manageru. Nepřipojujte čitelný `.env` s klíčem.
