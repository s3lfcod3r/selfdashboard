# 📰 Changelog

Newest version first. Detailed plugin and API notes (dated entries, plugin versions) are in [docs/CHANGELOG.md](docs/CHANGELOG.md).
Neueste Version zuerst. Ausführliche Plugin- und API-Notizen (datierte Einträge, Plugin-Versionen) stehen in [docs/CHANGELOG.md](docs/CHANGELOG.md).

> **⚠️ Update tip / Update-Hinweis:** Plugin updates need no new image — Plugin Store → **Update all** → **Ctrl+F5**. Core updates: pull the new image, keep `/app/data` and `/app/plugins/custom`. ·
> Plugin-Updates brauchen kein neues Image — Plugin-Store → **Alle aktualisieren** → **Strg+F5**. Kern-Updates: neues Image ziehen, `/app/data` und `/app/plugins/custom` behalten.

---

## 2.0.0 · June 2026 🔒
- 🇬🇧 Security & hardening: **non-root container (PUID/PGID)**, all credentials **AES-256-GCM-encrypted**, **SSRF guard** in every proxy plugin, **TOTP replay protection**, reproducible `npm ci` build + **HEALTHCHECK**; new plugins **Philips Hue**, **Homematic / RaspberryMatic**, **FRITZ! Smart Home**, **Bambu Lab Camera**, **Jellyfin**, **Selfstream · Emby · Jellyfin** plus 8 Beta integrations (Plex, Proxmox VE, TrueNAS, Home Assistant, OPNsense, UniFi, Nginx Proxy Manager, OpenMediaVault) and **Speedtest Tracker**; **auto-index store**; CrowdSec 1.5.x with attack **world map** and separate local / community (CAPI) ban counts.
- 🇩🇪 Sicherheit & Härtung: **Container ohne Root (PUID/PGID)**, alle Zugangsdaten **AES-256-GCM-verschlüsselt**, **SSRF-Schutz** in jedem Proxy-Plugin, **TOTP-Replay-Schutz**, reproduzierbarer `npm ci`-Build + **HEALTHCHECK**; neue Plugins **Philips Hue**, **Homematic / RaspberryMatic**, **FRITZ! Smart Home**, **Bambu Lab Kamera**, **Jellyfin**, **Selfstream · Emby · Jellyfin** sowie 8 Beta-Integrationen (Plex, Proxmox VE, TrueNAS, Home Assistant, OPNsense, UniFi, Nginx Proxy Manager, OpenMediaVault) und **Speedtest Tracker**; **Auto-Index-Store**; CrowdSec 1.5.x mit Angriffs-**Weltkarte** und getrennten Zählern für lokale / Community-Banns (CAPI).
- 📄 [docs/CHANGELOG.md](docs/CHANGELOG.md)

---

### 📱 SelfDashboard App v1.0.4
Android app — versioned separately from the dashboard · Android-App — getrennt vom Dashboard versioniert. Download: [releases/latest](https://github.com/s3lfcod3r/selfdashboard/releases/latest)
- 🇬🇧 WebView app for wall tablets: **login mode** or **kiosk mode** (view-only), **screen saver**, **pull-to-refresh**, full screen; no backend code of its own.
- 🇩🇪 WebView-App für Wand-Tablets: **Login-Modus** oder **Kiosk-Modus** (nur Ansicht), **Bildschirmschoner**, **Pull-to-Refresh**, Vollbild; kein eigener Backend-Code.
