# Changelog & recent features

This file summarizes **notable plugin and API behaviour** that may not fit in the short README tables. The full user guide remains **[README.md](../README.md)** (English and German in one file).

---

## 🇬🇧 English

### Core app 2.2.1 (2026-10) — Plugin Store

| Topic | Change |
|--------|--------|
| **Installed, not yet placed plugins** | Since the 2.2.0 loading tuning only widgets on a dashboard are loaded at start. For admins, installed plugins that were not placed yet never reached the widget registry, so the store showed “Ctrl+F5 after download” instead of **Add** — even after Ctrl+F5. The store now loads their `widget.js` when it opens. **New image.** |

### Unraid Docker plugin **0.4.16** (2026-10)

| Topic | Change |
|--------|--------|
| **Minimum width** | 2 columns instead of 4 (like the Docker widget), so Unraid Docker can replace the socket-based Docker widget as a narrow tile. **Plugin Store → Update → Ctrl+F5.** |

### CrowdSec plugin **1.6.1** (2026-10) — world map loaded on demand

| Topic | Change |
|--------|--------|
| **Smaller widget.js** | The world map's land and graticule paths (~200 KB) now live in `world-map.svg` and are fetched only when the map view opens. `widget.js` shrinks from ~240 KB to ~37 KB — less parse time on dashboard start. **Plugin Store → Update → Ctrl+F5.** |
| **Caching plugin files** | `/api/plugins/custom-assets/<id>/<file>?v=<installed version>` may now be cached for a year for any plugin file (not only `widget.js`/`.css`). **New image.** |

### CrowdSec plugin **1.6.0** (2026-10) — unban without Docker socket

| Topic | Change |
|--------|--------|
| **Unban via LAPI** | Unban now talks to the **CrowdSec Local API** (machine login `POST /v1/watchers/login`, then `DELETE /v1/decisions?ip=…`) instead of `docker exec crowdsec cscli …` over `/var/run/docker.sock`. The CrowdSec widget no longer needs the Docker socket. |
| **Setup** | `docker exec crowdsec cscli machines add selfdashboard --password '…' -f /dev/null`, then set `CROWDSEC_LAPI_URL` (default `http://crowdsec:8080`), `CROWDSEC_LAPI_MACHINE_ID`, `CROWDSEC_LAPI_PASSWORD` on the SelfDashboard container. |
| **Errors** | Missing credentials, rejected login and unreachable LAPI are shown as clear messages in the unban dialog (previously errors were silently ignored). |
| **User-Agent** | LAPI requests send `selfdashboard-crowdsec/<version>` — CrowdSec 1.8 rejects machine logins without a version in the User-Agent (`401`, log: `bad user agent`). |
| **Removed** | `CROWDSEC_CONTAINER` and the "CrowdSec container" field in the widget settings. The Docker socket is still used by the **Docker** widget only. |

### LLM-Cockpit plugin **1.1.x** (new, 2026-10)

Token counter, LLM speed and project status in **one** tile. The single tiles `llm-token`, `llm-tempo` and `openclaw-status` stay available. **Plugin Store → install "LLM-Cockpit" → Ctrl+F5.**

| Topic | Change |
|--------|--------|
| **Token counter** | In / out / peak context; dropdown for today, yesterday, last 7 days and every recorded month; bar chart of the last 14 days (or all days of the selected month, with a day list). |
| **LLM speed** | Only the servers listed in **"Only these servers"** (default `RTX2000`), with a small history of the last measurements. |
| **Project status** | One compact row per project (progress ring, done/total, open questions), click to expand; filters for questions / in progress / done and a time filter (7 / 30 / 90 days). Placeholders like `(keine)` no longer count as questions. |
| **Setup** | Empty addresses are taken over from existing `llm-token` / `llm-tempo` / `openclaw-status` tiles. Errors name the unreachable host and keep the last data visible. |
| **Collector service** | `/tokens` and `/status` come from a small collector container (e.g. `llm-sammler`: token totals per day and month from the llama.cpp `/metrics`, project status from the `STATUS.md` files). |
| **Layout** | Minimum width 2 columns. |

### Core app (2026-10-27) — many plugins on one dashboard

Measured on a test dashboard with 52 plugins. **New image; Plugin Store → update Bambu Lab Camera.**

| Topic | Change |
|--------|--------|
| **Bundle in parts** | The widget bundle is split into ~300 KB parts, each its own script — the browser can paint in between instead of running 1.6 MB at once. |
| **Auto-minify + transpile** | `esbuild` is now part of the image: every `widget.js` is transpiled for old WebViews (ES2017), unminified builds are minified automatically (cached per content). Previously the transpile step silently did nothing because `esbuild` was missing at runtime. |
| **Per-widget build cache** | New plugin combinations are assembled from cached parts (first build of a 52-plugin bundle: 503 ms before). |
| **Off-screen tiles** | Tiles far below the visible area are only mounted when scrolled near (no render time, no data requests before). Immediately in edit mode. Off: `localStorage.setItem('sd:noLazyWidgets','1')`. |
| **No needless widget renders** | Widgets are memoized: a re-render of the grid (e.g. once per bundle part) no longer re-renders every widget whose props did not change. On the 52-plugin page each widget rendered 25–67× in 10 s before. |
| **Perf report** | New column `KB`: size of each widget in the delivered bundle (determines parse/compile cost); also lists plugins not mounted yet. |
| **Bambu Lab Camera 0.9.4** | Uses the offline-host memory: a switched-off camera costs ~3 s only once instead of on every refresh. |
| **Weather 1.12.1** | Measures its width via `ResizeObserver` only — no forced layout of the whole page when the tile mounts. |

### Core app + plugins (2026-10) — loading performance

Measured on a dashboard with 24 widgets: browser blocking while loading **1.7 s → 0.07 s**, dashboard state **2.2 MB → 13 KB**, Docker widget **6–8 s → < 0.1 s**, unreachable hosts **3 s per request → instant**. **New image + Plugin Store → Update all → Ctrl+F5.**

| Topic | Change |
|--------|--------|
| **Widget bundle** | All `widget.js` (and `widget.css`) of a dashboard load in **one** request (`/api/plugins/widgets-bundle`), each widget isolated (errors don't break the others; failures fall back to single loading). `widget.css` is only requested where it exists. Debug: `localStorage.setItem('sd:noBundle','1')`. |
| **Central read cache** | Plugins opt in with **`readCache`** in `plugin.json`; the server then answers read requests within ≤ 300 ms (fresh if possible, otherwise the last answer while refreshing). Actions are never cached and clear the plugin's cache. Off: `SELFDASHBOARD_PLUGIN_READ_CACHE=0`. |
| **Offline-host memory** | Unreachable LAN hosts (`EHOSTUNREACH`, ~3 s each) are answered instantly; a background TCP probe every 15 s detects when they are back. Off: `SELFDASHBOARD_HOST_DOWN_MS=0`. |
| **Stale-while-revalidate** | Docker, AdGuard, CrowdSec, NetzWacht, Project status serve the last data instantly and refresh in the background. |
| **Docker** | Container stats via `one-shot` (no 1–2 s wait per container); CPU % from the previous sample. Volume `server.mjs` now uses the host's admin guard (previously start/stop had no admin check in the volume build). |
| **CrowdSec** | Database evaluation in a **worker thread** (no longer blocks the server); widget renders the feed in portions and skips identical poll data. |
| **Images in widget settings** | Large embedded images (e.g. bookmark icons as `data:` URIs) are moved to `/app/data/blobs/` and served as cacheable files — include `blobs/` in backups. |
| **Rendering** | Plugin registration notifies once per script (was once per plugin); grid measures size via `ResizeObserver` only (no forced reflow). |
| **Measuring** | `Server-Timing` on plugin APIs, slow requests in the container log, perf report in the browser console (`copy(__sdPerfReport.text)`); see [PLUGIN_PERFORMANCE.md](PLUGIN_PERFORMANCE.md). |

### Core app (2026-07) — SSRF default flipped to block private IPs

| Topic | Change |
|--------|--------|
| **Private LAN IPs blocked by default** | The SSRF guard now **blocks** private LAN targets (`10/8`, `172.16/12`, `192.168/16`) by default — previously they were allowed unless you opted in. **Homelab users who point plugins (Pi-hole, AdGuard, Home Assistant, Hue, NAS, self-hosted CalDAV/ICS …) at a LAN IP must now set `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1`** to re-enable access. Loopback / link-local / cloud-metadata stay blocked always. |
| **Open item** | `script-src` still uses `'unsafe-inline' 'unsafe-eval'`; a nonce-based CSP tightening remains a follow-up. DNS-rebinding/TOCTOU on outbound fetches is documented as a known limitation (would need a connection-pinning dispatcher). |

### Core app (2026-06) — security hardening

| Topic | Change |
|--------|--------|
| **Encrypted widget passwords** | Widget-config passwords (AdGuard, Pi-hole, FRITZ!Box, Fritz-Energy, Selfstream/-Emby) are sealed with **AES-256-GCM** (`sdsec1:` prefix) on save **and** on first read of existing configs. The browser only ever sees ciphertext; plugin servers decrypt server-side. Key: `SELFDASHBOARD_CALENDAR_KEY` / `<dataDir>/.calendar-key`. |
| **SSRF guard everywhere** | All proxy plugins now resolve DNS and block loopback / link-local / cloud-metadata targets (incl. IPv4-mapped IPv6). Blocked requests return `blocked_url` (HTTP 400). _Note: as of 2026-07 private LAN IPs are **blocked by default** — set `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` to allow them (see entry above)._ |
| **TOTP replay protection** | Each TOTP code/step is valid **once** (new `totp_last_step` column, auto-migrated). |
| **Non-root container** | App runs as UID **1001**; entrypoint chowns `/app/data` + `/app/plugins/custom` on start (opt-out `SELFDASHBOARD_SKIP_CHOWN=1`) and adds read perms on `/crowdsec-data` (opt-out `SELFDASHBOARD_FIX_CROWDSEC_PERMS=0`). |
| **Image build** | `npm ci` (reproducible), `HEALTHCHECK` on `/api/auth/setup-status`, plugin-id validation on store installs, scoped TLS handling for FRITZ! self-signed certs (no more global `NODE_TLS_REJECT_UNAUTHORIZED`). |
| **Theme reactivity** | The theme provider now subscribes to the theme value reactively — light/dark and colour schemes apply **instantly app-wide** (previously only after a page reload; only CrowdSec updated live). Picking a theme also clears custom colours. |

### Plugins (2026-06) — store update recommended

| Plugin | Version | Change |
|--------|---------|--------|
| AdGuard / Pi-hole | **1.2.2** | SSRF guard + sealed-password support |
| FRITZ!Box | **2.5.7** | SSRF guard, sealed passwords, scoped TLS agent |
| Fritz-Energy | **1.3.3** | SSRF guard, sealed passwords, scoped TLS agent |
| Selfstream | **1.1.2** | SSRF guard + sealed-password support (also used by Selfstream-Emby) |
| Uptime Kuma | **1.0.6** | SSRF guard |
| Philips Hue | **Beta** | Hue-app-style room/light control: toggles, brightness, real light colour, colour picker |
| Homematic / RaspberryMatic | **Beta** | Heating (target temp + Auto/Manual/Boost), switches, RGBW colour, window contacts, sensors, sysvars, programs; auto-grouped by CCU room (drag-and-drop, multi-column), renamable devices; JSON-RPC login |

After **Update all**: **Ctrl+F5**. Existing plaintext passwords are migrated automatically on next load.

### Core app (2026-05) — post-beta

| Topic | Change |
|--------|--------|
| **Legacy API removed** | Old paths (`/api/weather`, `/api/calendar/*`, `/api/mail/*`, …) removed. Use **`/api/plugins/<id>/…`** only. Requires **new app image**. |

### Core app (2026-05)

| Topic | Change |
|--------|--------|
| **Public kiosk `/kiosk`** | View-only wall-tablet URL without admin login; optional password & session duration. Admin: **Settings → Users → Kiosk**. Edit widgets on `/dashboard/<id>`. |
| **TOTP 2FA** | Authenticator apps — **Settings → Users**; enforced at login when enabled. |
| **Multi-user UI** | Password change, 2FA, and kiosk moved to **Settings → Users**. |
| **Design backgrounds** | **Settings → Design**: navbar wallpaper; dashboard background **off / single / dual** (JPG/PNG/WebP, overlay %). Persisted in `dashboard.json`. |
| **`/api/plugins/weather/*`** | Server proxy for Open-Meteo geocode + forecast (hourly + daily). Required for current Weather plugin. |
| **Settings modal** | Fixed width `720px`; log list scrolls internally. |

### Weather plugin **1.3.x**

| Topic | Change |
|--------|--------|
| **Day blocks** | Under current summary: temps for **0–6**, **6–12**, **12–18**, **18–24** (today, from hourly API). |
| **7-day strip** | Shows **next 7 days starting tomorrow** (API `forecast_days=8`, skips index 0). |
| **Removed** | Full-width hourly timeline that replaced the 7-day view in 1.3.0. |

### Unraid plugin **1.5.x**

| Topic | Change |
|--------|--------|
| **Version** | Targets **Unraid 7.2+** GraphQL (not 7.3-only). |
| **Disks** | Pool/cache rows; optional suffix: role / `fsType` / comment. |
| **Browser** | Direct `fetch` to `https://NAS/graphql` — **CORS** must allow your dashboard origin per NAS. |

---

## 🇩🇪 Deutsch

### Kern-App 2.2.1 (2026-10) — Plugin-Store

| Thema | Änderung |
|--------|--------|
| **Installierte, noch nicht platzierte Plugins** | Seit dem Lade-Tuning in 2.2.0 werden beim Start nur Widgets geladen, die auf einem Dashboard liegen. Installierte, noch nicht platzierte Plugins kamen für Admins dadurch nie in die Widget-Registry — der Store zeigte „Strg+F5 nach Download“ statt **Hinzufügen**, auch nach Strg+F5. Der Store lädt deren `widget.js` jetzt beim Öffnen nach. **Neues Image.** |

### Unraid-Docker-Plugin **0.4.16** (2026-10)

| Thema | Änderung |
|--------|--------|
| **Mindestbreite** | 2 statt 4 Spalten (wie beim Docker-Widget), damit Unraid Docker das Docker-Widget mit Socket als schmale Kachel ersetzen kann. **Plugin-Store → Aktualisieren → Strg+F5.** |

### CrowdSec-Plugin **1.6.1** (2026-10) — Weltkarte nachgeladen

| Thema | Änderung |
|--------|--------|
| **Kleineres widget.js** | Länder- und Gradnetz-Pfade der Weltkarte (~200 KB) liegen jetzt in `world-map.svg` und werden erst beim Öffnen der Kartenansicht geladen. `widget.js` schrumpft von ~240 KB auf ~37 KB — weniger Parse-Zeit beim Dashboard-Start. **Plugin-Store → Aktualisieren → Strg+F5.** |
| **Cache für Plugin-Dateien** | `/api/plugins/custom-assets/<id>/<datei>?v=<installierte Version>` darf jetzt für jede Plugin-Datei (nicht nur `widget.js`/`.css`) ein Jahr gecacht werden. **Neues Image.** |

### CrowdSec-Plugin **1.6.0** (2026-10) — Entsperren ohne Docker-Socket

| Thema | Änderung |
|--------|--------|
| **Entsperren per LAPI** | Entsperren spricht jetzt die **CrowdSec Local API** an (Maschinen-Login `POST /v1/watchers/login`, dann `DELETE /v1/decisions?ip=…`) statt `docker exec crowdsec cscli …` über `/var/run/docker.sock`. Das CrowdSec-Widget braucht den Docker-Socket nicht mehr. |
| **Einrichtung** | `docker exec crowdsec cscli machines add selfdashboard --password '…' -f /dev/null`, dann am SelfDashboard-Container `CROWDSEC_LAPI_URL` (Standard `http://crowdsec:8080`), `CROWDSEC_LAPI_MACHINE_ID`, `CROWDSEC_LAPI_PASSWORD` setzen. |
| **Fehler** | Fehlende Zugangsdaten, abgelehnter Login und nicht erreichbare LAPI erscheinen als klare Meldung im Entsperren-Dialog (bisher wurden Fehler still verschluckt). |
| **User-Agent** | LAPI-Anfragen senden `selfdashboard-crowdsec/<version>` — CrowdSec 1.8 lehnt Maschinen-Logins ohne Version im User-Agent ab (`401`, Log: `bad user agent`). |
| **Entfernt** | `CROWDSEC_CONTAINER` und das Feld „CrowdSec-Container“ in den Widget-Einstellungen. Den Docker-Socket nutzt nur noch das **Docker**-Widget. |

### LLM-Cockpit-Plugin **1.1.x** (neu, 2026-10)

Token-Zähler, LLM-Tempo und Projektstatus in **einer** Kachel. Die Einzel-Kacheln `llm-token`, `llm-tempo` und `openclaw-status` bleiben verfügbar. **Plugin-Store → „LLM-Cockpit“ installieren → Strg+F5.**

| Thema | Änderung |
|--------|--------|
| **Token-Zähler** | Rein / raus / max. Kontext; Auswahl für heute, gestern, letzte 7 Tage und jeden erfassten Monat; Balkendiagramm der letzten 14 Tage (bzw. aller Tage des gewählten Monats, mit Tagesliste). |
| **LLM-Tempo** | Nur die Server aus **„Nur diese Server“** (Standard `RTX2000`), mit kleinem Verlauf der letzten Messungen. |
| **Projektstatus** | Eine kompakte Zeile je Projekt (Fortschrittsring, erledigt/gesamt, offene Fragen), per Klick aufklappbar; Filter für Fragen / in Arbeit / fertig und ein Zeitfilter (7 / 30 / 90 Tage). Platzhalter wie `(keine)` zählen nicht mehr als Frage. |
| **Einrichtung** | Leere Adressen werden aus vorhandenen `llm-token`- / `llm-tempo`- / `openclaw-status`-Kacheln übernommen. Fehler nennen den nicht erreichbaren Host, die letzten Daten bleiben sichtbar. |
| **Sammel-Dienst** | `/tokens` und `/status` liefert ein kleiner Sammel-Container (z. B. `llm-sammler`: Token-Summen je Tag und Monat aus den llama.cpp-`/metrics`, Projektstatus aus den `STATUS.md`-Dateien). |
| **Layout** | Mindestbreite 2 Spalten. |

### Kern-App (2026-10-27) — viele Plugins auf einem Dashboard

Gemessen an einem Test-Dashboard mit 52 Plugins. **Neues Image; Plugin-Store → Bambu Lab Kamera aktualisieren.**

| Thema | Änderung |
|--------|--------|
| **Bundle in Teilen** | Das Widget-Bundle wird in Teile von ~300 KB aufgeteilt, jeder als eigenes Skript — der Browser kann dazwischen zeichnen, statt 1,6 MB am Stück auszuführen. |
| **Automatisch minifizieren + übersetzen** | `esbuild` ist jetzt im Image: jedes `widget.js` wird für ältere WebViews übersetzt (ES2017), unminifizierte Builds werden automatisch minifiziert (pro Inhalt gecacht). Vorher lief das Übersetzen still ins Leere, weil `esbuild` zur Laufzeit fehlte. |
| **Bundle-Cache pro Widget** | Neue Plugin-Kombinationen werden aus gecachten Teilen zusammengesetzt (erster Bau eines 52-Plugin-Bundles vorher: 503 ms). |
| **Kacheln außerhalb des Sichtfelds** | Kacheln weit unterhalb des sichtbaren Bereichs werden erst beim Hinscrollen eingehängt (vorher keine Renderzeit, keine Datenabrufe). Im Bearbeitungsmodus sofort. Aus: `localStorage.setItem('sd:noLazyWidgets','1')`. |
| **Kein unnötiges Mit-Rendern** | Widgets sind memoisiert: Rendert das Raster neu (z. B. einmal pro Bundle-Teil), rendern Widgets mit unveränderten Props nicht mehr mit. Auf der 52-Plugin-Seite renderte vorher jedes Widget 25–67× in 10 s. |
| **Perf-Bericht** | Neue Spalte `KB`: Größe jedes Widgets im ausgelieferten Bundle (bestimmt die Kosten fürs Einlesen); zeigt auch noch nicht eingehängte Plugins. |
| **Bambu Lab Kamera 0.9.4** | Nutzt den Offline-Merker: eine ausgeschaltete Kamera kostet nur einmal ~3 s statt bei jeder Aktualisierung. |
| **Wetter 1.12.1** | Misst seine Breite nur noch per `ResizeObserver` — kein erzwungenes Neu-Layout der ganzen Seite beim Einhängen. |

### Kern-App + Plugins (2026-10) — Ladezeit

Gemessen an einem Dashboard mit 24 Widgets: Browser-Blockade beim Laden **1,7 s → 0,07 s**, Dashboard-Zustand **2,2 MB → 13 KB**, Docker-Widget **6–8 s → < 0,1 s**, nicht erreichbare Hosts **3 s pro Anfrage → sofort**. **Neues Image + Plugin-Store → Alle aktualisieren → Strg+F5.**

| Thema | Änderung |
|--------|--------|
| **Widget-Bundle** | Alle `widget.js` (und `widget.css`) eines Dashboards laden in **einer** Anfrage (`/api/plugins/widgets-bundle`), jedes Widget gekapselt (Fehler reißen die anderen nicht mit; Gescheitertes wird einzeln nachgeladen). `widget.css` wird nur noch angefragt, wo es existiert. Debug: `localStorage.setItem('sd:noBundle','1')`. |
| **Zentraler Lese-Cache** | Plugins melden sich mit **`readCache`** in der `plugin.json` an; der Server beantwortet Lese-Anfragen dann in ≤ 300 ms (frisch wenn möglich, sonst die letzte Antwort, während im Hintergrund aufgefrischt wird). Aktionen werden nie gecacht und leeren den Cache des Plugins. Aus: `SELFDASHBOARD_PLUGIN_READ_CACHE=0`. |
| **Offline-Merker** | Nicht erreichbare LAN-Hosts (`EHOSTUNREACH`, je ~3 s) werden sofort beantwortet; eine TCP-Probe im Hintergrund prüft alle 15 s, ob sie wieder da sind. Aus: `SELFDASHBOARD_HOST_DOWN_MS=0`. |
| **Stale-while-revalidate** | Docker, AdGuard, CrowdSec, NetzWacht, Projektstatus liefern die letzten Daten sofort und frischen im Hintergrund auf. |
| **Docker** | Container-Stats per `one-shot` (kein 1–2-s-Warten pro Container); CPU-% aus der vorherigen Messung. Volume-`server.mjs` nutzt jetzt den Admin-Guard des Hosts (Start/Stop hatte im Volume-Build vorher keinen Admin-Check). |
| **CrowdSec** | Datenbank-Auswertung in einem **Worker-Thread** (blockiert den Server nicht mehr); das Widget rendert den Feed portionsweise und überspringt identische Poll-Daten. |
| **Bilder in Widget-Einstellungen** | Große eingebettete Bilder (z. B. Bookmark-Icons als `data:`-URI) werden nach `/app/data/blobs/` ausgelagert und als cachebare Dateien ausgeliefert — `blobs/` mitsichern. |
| **Rendern** | Plugin-Registrierung benachrichtigt einmal pro Skript (vorher pro Plugin); das Raster misst Größen nur noch per `ResizeObserver` (kein erzwungener Reflow). |
| **Messen** | `Server-Timing` an Plugin-APIs, langsame Anfragen im Container-Log, Perf-Bericht in der Browser-Konsole (`copy(__sdPerfReport.text)`); siehe [PLUGIN_PERFORMANCE.md](PLUGIN_PERFORMANCE.md). |

### Kern-App (2026-07) — SSRF-Default blockt jetzt private IPs

| Thema | Änderung |
|--------|----------|
| **Private LAN-IPs standardmäßig geblockt** | Der SSRF-Schutz **blockt** private LAN-Ziele (`10/8`, `172.16/12`, `192.168/16`) jetzt standardmäßig — vorher waren sie erlaubt, sofern man nicht ausdrücklich blockte. **Homelab-Nutzer, die Plugins (Pi-hole, AdGuard, Home Assistant, Hue, NAS, selbstgehostetes CalDAV/ICS …) auf eine LAN-IP zeigen, müssen jetzt `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` setzen**, um den Zugriff wieder freizuschalten. Loopback / Link-Local / Cloud-Metadata bleiben immer geblockt. |
| **Offener Punkt** | `script-src` nutzt weiterhin `'unsafe-inline' 'unsafe-eval'`; eine Nonce-basierte CSP-Verschärfung bleibt ein Folge-Schritt. DNS-Rebinding/TOCTOU bei ausgehenden Fetches ist als bekannte Einschränkung dokumentiert (bräuchte einen Connection-Pinning-Dispatcher). |

### Kern-App (2026-06) — Security-Härtung

| Thema | Änderung |
|--------|----------|
| **Verschlüsselte Widget-Passwörter** | Widget-Passwörter (AdGuard, Pi-hole, FRITZ!Box, Fritz-Energy, Selfstream/-Emby) werden mit **AES-256-GCM** versiegelt (`sdsec1:`-Präfix) — beim Speichern **und** beim ersten Laden bestehender Configs. Der Browser sieht nur noch Ciphertext; Plugin-Server entschlüsseln serverseitig. Schlüssel: `SELFDASHBOARD_CALENDAR_KEY` / `<dataDir>/.calendar-key`. |
| **SSRF-Schutz überall** | Alle Proxy-Plugins lösen DNS auf und blocken Loopback / Link-Local / Cloud-Metadata (inkl. IPv4-mapped IPv6). Geblockte Anfragen liefern `blocked_url` (HTTP 400). _Hinweis: seit 2026-07 sind private LAN-IPs **standardmäßig geblockt** — `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` erlaubt sie wieder (siehe Eintrag oben)._ |
| **TOTP-Replay-Schutz** | Jeder TOTP-Code/Step gilt nur **einmal** (neue Spalte `totp_last_step`, automatische Migration). |
| **Non-root-Container** | App läuft als UID **1001**; Entrypoint chownt `/app/data` + `/app/plugins/custom` beim Start (Opt-out `SELFDASHBOARD_SKIP_CHOWN=1`) und setzt Leserechte auf `/crowdsec-data` (Opt-out `SELFDASHBOARD_FIX_CROWDSEC_PERMS=0`). |
| **Image-Build** | `npm ci` (reproduzierbar), `HEALTHCHECK` auf `/api/auth/setup-status`, Plugin-ID-Validierung bei Store-Installs, gescopetes TLS-Handling für selbstsignierte FRITZ!-Zertifikate (kein globales `NODE_TLS_REJECT_UNAUTHORIZED` mehr). |
| **Theme-Reaktivität** | Der Theme-Provider abonniert den Theme-Wert jetzt reaktiv — Hell/Dunkel und Farbschemata greifen **sofort app-weit** (vorher erst nach Reload; live aktualisierte sich nur CrowdSec). Eine Theme-Auswahl setzt außerdem die Eigenfarben zurück. |

### Plugins (2026-06) — Store-Update empfohlen

| Plugin | Version | Änderung |
|--------|---------|----------|
| AdGuard / Pi-hole | **1.2.2** | SSRF-Schutz + versiegelte Passwörter |
| FRITZ!Box | **2.5.7** | SSRF-Schutz, versiegelte Passwörter, gescopeter TLS-Agent |
| Fritz-Energy | **1.3.3** | SSRF-Schutz, versiegelte Passwörter, gescopeter TLS-Agent |
| Selfstream | **1.1.2** | SSRF-Schutz + versiegelte Passwörter (auch von Selfstream-Emby genutzt) |
| Uptime Kuma | **1.0.6** | SSRF-Schutz |
| Philips Hue | **Beta** | Räume/Lampen im Hue-App-Stil: Toggles, Helligkeit, echte Lichtfarbe, Farbwähler |
| Homematic / RaspberryMatic | **Beta** | Heizung (Soll-Temp + Auto/Manuell/Boost), Schalter, RGBW-Farbe, Fensterkontakte, Sensoren, Sysvars, Programme; auto-gruppiert nach CCU-Raum (Drag-and-Drop, mehrspaltig), umbenennbare Geräte; JSON-RPC-Login |

Nach **Update all**: **Strg+F5**. Bestehende Klartext-Passwörter werden beim nächsten Laden automatisch migriert.

### Kern-App (2026-05) — nach Beta

| Thema | Änderung |
|--------|----------|
| **Legacy-API entfernt** | Alte Pfade (`/api/weather`, `/api/calendar/*`, `/api/mail/*`, …) entfernt. Nur noch **`/api/plugins/<id>/…`**. **Neues App-Image** nötig. |

### Kern-App (2026-05)

| Thema | Änderung |
|--------|----------|
| **Öffentlicher Kiosk `/kiosk`** | Nur-Ansicht fürs Wand-Tablet ohne Admin-Login; optional Passwort & Sitzungsdauer. Admin: **Einstellungen → Benutzer → Kiosk**. Bearbeiten unter `/dashboard/<id>`. |
| **TOTP 2FA** | Authenticator-Apps — **Einstellungen → Benutzer**; beim Login wenn aktiv. |
| **Mehrbenutzer-UI** | Passwort, 2FA, Kiosk unter **Einstellungen → Benutzer**. |
| **Hintergrundbilder** | **Einstellungen → Design**: Navbar + Dashboard (**Aus / 1 / 2 Bilder**, Overlay). In `dashboard.json`. |
| **`/api/plugins/weather/*`** | Server-Proxy für Open-Meteo (Geocoding + Forecast). |
| **Einstellungs-Dialog** | Feste Breite; Protokoll-Liste scrollt intern. |

### Wetter-Plugin **1.3.x**

| Thema | Änderung |
|--------|----------|
| **Tagesabschnitte** | Unter aktuellem Wetter: **0–6**, **6–12**, **12–18**, **18–24**. |
| **7-Tage** | Ab **morgen** (8 API-Tage, heute ausgeblendet). |
| **Entfernt** | Stündliche Gesamt-Leiste aus 1.3.0. |

### Unraid-Plugin **1.5.x**

| Thema | Änderung |
|--------|----------|
| **Version** | **Unraid 7.2+** GraphQL (nicht nur 7.3). |
| **Disks** | Pool/Cache; Zusatz-Label: Rolle / `fsType` / Kommentar. |
| **Browser** | Direkt `https://NAS/graphql` — **CORS** pro NAS für Dashboard-Origin. |

---

## 🇬🇧 English (older entries)

### Docker plugin **1.7.9** (core: `src/lib/dockerEngine.ts`)

| Topic | Change |
|--------|--------|
| **RAM** | Matches **`docker stats`** / Docker CLI: working set = `memory_stats.usage` minus page cache (`total_inactive_file` on cgroup v1, `inactive_file` on v2). Aligns better with Unraid’s Docker tab and other UIs that follow the same rule — not raw cgroup `usage`. |
| **CPU %** | Same delta formula as the Engine / CLI. Ignores samples where the `system_cpu_usage` delta is **&lt; 10 ms** (nanoseconds threshold) to avoid meaningless spikes from ultra-short windows. |
| **Stats HTTP call** | Prefers `GET /containers/{id}/stats?stream=false&one-shot=false` so the daemon can populate **`precpu_stats`** for a valid CPU delta. If the daemon returns **HTTP 400** (very old engines), falls back to `stream=false` only. |

**APIs (unchanged paths):** `GET /api/docker-containers?…&stats=1`, `POST /api/docker-container-stats` — response shape unchanged; numeric **RAM** values may differ from pre-1.7.9 builds because of the definition above.

---

### Calendar plugin **1.4.x**

| Topic | Description |
|--------|-------------|
| **API** | Unified under **`/api/calendar/*`**: `accounts`, `events`, `calendars`, `sync`, `status`, `summary`, `conflicts` (no separate `calendar-ics` / `calendar-caldav` routes). |
| **ICS / Webcal** | Read-only feeds via account type **ICS**; server-side fetch (no browser CORS; LAN URLs work). |
| **CalDAV** | Two-way accounts: Basic auth; sync via **`POST /api/calendar/accounts/[id]/sync`** (GET/REPORT as needed, e.g. Nextcloud, Synology). |
| **Storage** | `data/calendar/` on the server; credentials encrypted (AES-256-GCM). |
| **Widget** | Month/week views, day panel, local events; background sync (`CALENDAR_SYNC_INTERVAL_SECONDS`, default 5 min). |

---

### Selfstream plugin **1.0.x**

| Topic | Description |
|--------|-------------|
| **Data** | Active IPTV sessions from Selfstream admin via **`POST /api/selfstream`**. |
| **Widget** | Lists live streams (user, channel/program, duration); optional client IP; configurable refresh interval. |
| **Auth** | Admin password in plugin settings; proxied server-side (not stored in the central error log). |

---

### FRITZ!Box WAN throughput plugin **2.3.x**

| Topic | Description |
|--------|-------------|
| **Data** | TR-064 byte counters via **`POST /api/fritzbox`**; optional **`lite: true`** for counter-only updates. |
| **History** | Last chart points cached in **`localStorage`** (per base URL + username), up to **7 days**, so the chart is not empty after reload. |
| **Layout & UI** | Vertical vs horizontal layout; toggles for title, legend, live values, chart, time-axis hint, stat tiles. |
| **Plot height** | **`0`** = default **168 px**; **`1–220`** = exact height in pixels. |
| **Y-axis** | **`0` Mbit/s max** = auto scale from data; fixed max caps the scale. |
| **Sanity cap** | Optional max measured rate (Mbit/s) for both directions; **`0`** uses TR-064 Layer1 hints + small headroom where available. |
| **Polling** | Full TR-064 interval **0–300 s** (`0` = only on dashboard load); **live counter** interval **0** or **3–15 s** for smoother curves. |
| **Language** | Auto / German / English for UI strings. |

---

## 🇩🇪 Deutsch (ältere Einträge)

### Docker-Plugin **1.7.9** (Kern: `src/lib/dockerEngine.ts`)

| Thema | Änderung |
|--------|----------|
| **RAM** | Entspricht **`docker stats`** / Docker-CLI: nutzbarer Speicher = `memory_stats.usage` minus Datei-Cache (`total_inactive_file` bei cgroup v1, `inactive_file` bei v2). Passt besser zur Unraid-Docker-Ansicht und ähnlichen Oberflächen — nicht der rohe cgroup-`usage`-Wert. |
| **CPU-%** | Gleiche Delta-Formel wie Engine/CLI. Messungen mit `system_cpu_usage`-Delta **&lt; 10 ms** werden verworfen, um sinnlose Spitzen zu vermeiden. |
| **Stats-HTTP-Aufruf** | Bevorzugt `GET …/stats?stream=false&one-shot=false`, damit **`precpu_stats`** zuverlässig gefüllt ist. Bei **HTTP 400** (sehr alte Daemons) Fallback nur `stream=false`. |

**APIs:** `GET /api/docker-containers?…&stats=1`, `POST /api/docker-container-stats` — gleiche Pfade und Felder; **RAM-Zahlen** können sich gegenüber älteren Builds ändern (siehe Definition oben).

---

### Kalender-Plugin **1.4.x**

| Thema | Beschreibung |
|--------|----------------|
| **API** | Einheitlich unter **`/api/calendar/*`**: `accounts`, `events`, `calendars`, `sync`, `status`, `summary`, `conflicts` (keine separaten Routen `calendar-ics` / `calendar-caldav`). |
| **ICS / Webcal** | Nur-Lese-Feeds über Kontotyp **ICS**; serverseitiger Abruf (kein CORS im Browser; LAN-URLs möglich). |
| **CalDAV** | Zwei-Wege-Konten: Basic-Auth; Sync über **`POST /api/calendar/accounts/[id]/sync`** (GET/REPORT je nach Server, z. B. Nextcloud, Synology). |
| **Speicher** | `data/calendar/` auf dem Server; Zugangsdaten verschlüsselt (AES-256-GCM). |
| **Widget** | Monat/Woche, Tagespanel, lokale Termine; Hintergrund-Sync (`CALENDAR_SYNC_INTERVAL_SECONDS`, Standard 5 min). |

---

### Selfstream-Plugin **1.0.x**

| Thema | Beschreibung |
|--------|----------------|
| **Daten** | Aktive IPTV-Sessions aus dem Selfstream-Admin über **`POST /api/selfstream`**. |
| **Widget** | Liste laufender Streams (Nutzer, Sender/Sendung, Laufzeit); optional Client-IP; Aktualisierungsintervall einstellbar. |
| **Auth** | Admin-Passwort in den Plugin-Einstellungen; serverseitiger Proxy (nicht im zentralen Protokoll gespeichert). |

---

### Fritzbox-Plugin **2.3.x** (Internet-Verlauf)

| Thema | Beschreibung |
|--------|----------------|
| **Daten** | TR-064-Bytezähler über **`POST /api/fritzbox`**; optional **`lite: true`** nur für Zähler. |
| **Verlauf** | Kurvenpunkte im **`localStorage`** (pro Basis-URL + Benutzer), bis **7 Tage**. |
| **Layout & UI** | Vertikal/waagerecht; Schalter für Überschrift, Legende, Live-Werte, Kurve, Zeitachsen-Hinweis, Stat-Karten. |
| **Plot-Höhe** | **`0`** = Standard **168 px**; **`1–220`** = exakte Pixelhöhe. |
| **Y-Achse** | **`0` Mbit/s** = aus Daten; fester Wert = oben begrenzt. |
| **Ausreißer** | Optional **Max. Messrate (Mbit/s)**; **`0`** = Layer1-Hinweise von der Box + Puffer. |
| **Abfragen** | Voller TR-064-Takt **0–300 s**; **Zähler-Takt** **0** oder **3–15 s**. |
| **Sprache** | Auto / Deutsch / Englisch. |

---

### FRITZ! smart plug energy (`fritz-energy`) **1.1.x**

| Topic | Description |
|--------|-------------|
| **Data** | TR-064 Homeauto via **`POST /api/fritz-energy`**; current W, today / 7 days / month kWh; history under `data/fritz-energy/`. |
| **Widget** | Grid (2×2 fill) or carousel; optional compact UI; silent background refresh (no “Updating…” flash). |
| **Setup** | AIN + same TR-064 credentials as WAN plugin; Smart Home rights on the FRITZ!Box user. |

**DE:** Steckdose Energie im Image — README **FRITZ! Steckdose Energie**.

---

### Kiosk mode (core)

| Topic | Description |
|--------|-------------|
| **Settings** | **General → Kiosk mode** — auto-hide navbar after **3–60 s** idle (default **5**). |
| **UI** | Hidden bar uses `translateY` (no layout gap); widgets start at the top. |
| **Reveal** | Accent **Menu** / **Leiste** button only — not mouse over widgets. Edit mode keeps the bar visible. |

**DE:** README **Kiosk-Modus (Wand-Tablet)**.

---

### AdGuard Home **1.1.6**

2×2 stat tiles stretch to full widget height (no empty band at the bottom).

**DE:** Kacheln füllen die Widget-Höhe.

---

## Plugin versions (reference)

Builtin plugin `meta.version` values in the repo (see each `plugins/<id>/index.tsx`):

| Plugin | Version (approx.) |
|--------|-------------------|
| Docker | 1.7.9 |
| FRITZ!Box Internet | 2.4.3 |
| FRITZ! Steckdose Energie | 1.1.3 |
| Calendar | 1.4.2 |
| Bookmarks | 1.6.0 |
| Unraid Docker | 0.4.4 |
| Iframe | 2.1.4 |
| Weather | 1.2.3 |
| AdGuard Home | 1.1.6 |
| Clock | 1.2.1 |
| Unraid | 1.5.3 |
| Emby | 1.0.3 |
| Scratchpad | 1.1.1 |

*(Versions ship with the Docker image; bump dates are git history.)*

