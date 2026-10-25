# 📰 Changelog

Newest version first. Detailed plugin and API notes (dated entries, plugin versions) are in [docs/CHANGELOG.md](docs/CHANGELOG.md).
Neueste Version zuerst. Ausführliche Plugin- und API-Notizen (datierte Einträge, Plugin-Versionen) stehen in [docs/CHANGELOG.md](docs/CHANGELOG.md).

> **⚠️ Update tip / Update-Hinweis:** Plugin updates need no new image — Plugin Store → **Update all** → **Ctrl+F5**. Core updates: pull the new image, keep `/app/data` and `/app/plugins/custom`. ·
> Plugin-Updates brauchen kein neues Image — Plugin-Store → **Alle aktualisieren** → **Strg+F5**. Kern-Updates: neues Image ziehen, `/app/data` und `/app/plugins/custom` behalten.

---

## 2.2.0 · October 2026 ⚡
- 🇬🇧 **Much faster loading:** all widgets load in **one bundle**, central **read cache** for plugin APIs, **offline-host memory** (unreachable devices answer instantly instead of after ~3 s), stale-while-revalidate for Docker / AdGuard / CrowdSec / NetzWacht / project status, CrowdSec evaluation in a worker thread, large images from widget settings moved to `/app/data/blobs/` (measured: browser blocking 1.7 s → 0.07 s, dashboard state 2.2 MB → 13 KB); **unit system** metric / imperial / auto, also per widget (Weather, FRITZ!, Homematic, Google Home, Unraid °F); private LAN IPs are **blocked by default** (SSRF) — set `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` in a home network; new plugin **LLM-Cockpit** (token counter, LLM speed, project status in one tile); Shelly Plug with **Wake-on-LAN**; Unraid template with all new variables, Unraid README in English + German; license changed to **all rights reserved** (private, non-commercial use allowed).
- 🇩🇪 **Deutlich schnelleres Laden:** alle Widgets kommen in **einem Paket**, zentraler **Lese-Cache** für Plugin-APIs, **Offline-Merker** (nicht erreichbare Geräte antworten sofort statt nach ~3 s), Stale-while-revalidate für Docker / AdGuard / CrowdSec / NetzWacht / Projektstatus, CrowdSec-Auswertung im Worker-Thread, große Bilder aus Widget-Einstellungen nach `/app/data/blobs/` ausgelagert (gemessen: Browser-Blockade 1,7 s → 0,07 s, Dashboard-Zustand 2,2 MB → 13 KB); **Einheitensystem** metrisch / imperial / automatisch, auch pro Widget (Wetter, FRITZ!, Homematic, Google Home, Unraid °F); private LAN-IPs sind **standardmäßig blockiert** (SSRF) — im Heimnetz `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` setzen; neues Plugin **LLM-Cockpit** (Token-Zähler, LLM-Tempo, Projektstatus in einer Kachel); Shelly Plug mit **Wake-on-LAN**; Unraid-Template mit allen neuen Variablen, Unraid-README auf Englisch + Deutsch; Lizenz auf **alle Rechte vorbehalten** umgestellt (private, nicht-kommerzielle Nutzung erlaubt).
- 📄 [docs/CHANGELOG.md](docs/CHANGELOG.md)

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
