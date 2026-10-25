# Unraid — SelfDashboard

**[🇬🇧 English](#english)** · **[🇩🇪 Deutsch](#deutsch)**

Template: [`selfdashboard.xml`](selfdashboard.xml) — Template URL: `https://raw.githubusercontent.com/s3lfcod3r/selfdashboard/main/unraid/selfdashboard.xml`

---

<a id="english"></a>

## 🇬🇧 English

### Install

1. **Docker → Add Container → Template**, paste the template URL above (or install via Community Applications).
2. Check the two paths, set a **Secret Key**, apply.
3. Open `http://<unraid-ip>:3000`, create the admin account.
4. **Plugin Store → From GitHub** — install the widgets you want, then **Ctrl+F5**.

### Paths

| Container | Host (default) | Purpose |
|---|---|---|
| `/app/data` | `/mnt/user/appdata/selfdashboard` | Dashboards (`users/`), images from widget settings (`blobs/`), login (`auth/auth.db`), calendar, logs, key files (`.calendar-key`, `.secret-salt`) |
| `/app/plugins/custom` | `/mnt/user/appdata/selfdashboard/plugins` | Installed plugins (`plugin.json`, `widget.js`, `server.mjs`) |
| `/crowdsec-data` *(optional, ro)* | e.g. `/mnt/user/appdata/crowdsec/data` | `crowdsec.db` and optional `GeoLite2-*.mmdb` for the CrowdSec widget |
| `/var/run/docker.sock` *(optional, ro)* | `/var/run/docker.sock` | Docker widget (this host only) |

### Variables

Everything works with the template defaults. Fields marked *advanced* only appear under **Show more settings**.

**Basics**

| Variable | Default | Purpose |
|---|---|---|
| `SELFDASHBOARD_SECRET_KEY` | empty | **Strongly recommended.** Fixed key for all stored credentials (calendar, mail, widget passwords). Set once, **never change** — otherwise stored passwords become unreadable. |
| `SELFDASHBOARD_ALLOW_PRIVATE_URLS` | `1` | Lets widgets reach LAN IPs (`192.168.x`, `10.x`, `172.16–31.x`). Keep `1` in a home network; empty/`0` blocks them (`private_ip_blocked`). |
| `TZ` | `Europe/Berlin` | Timezone |
| `PUID` / `PGID` *(advanced)* | `99` / `100` | User/group the app runs as. With CrowdSec: same values as the CrowdSec container. |
| `SELFDASHBOARD_PLUGINS_GITHUB_REPO` / `_REF` / `_PATH` | `s3lfcod3r/selfdashboard` / `main` / `plugins-pack` | Source of the Plugin Store. Normally leave as is. |

**Security** *(advanced)*

| Variable | Default | Purpose |
|---|---|---|
| `SELFDASHBOARD_SECURE_COOKIES` | empty | Set `1` as soon as the dashboard is served over HTTPS (reverse proxy). |
| `SELFDASHBOARD_TRUST_PROXY` | empty | `1` **only** behind a reverse proxy that sets `X-Forwarded-For`. Without a proxy these headers can be spoofed. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | empty | `0` disables certificate checks for **all** outgoing HTTPS — see [Self-signed HTTPS](#en-tls). |
| `SELFDASHBOARD_AUTH_RESET_PASSWORD` / `_USER` | empty | Admin password reset — see [Forgot password](#en-reset). |
| `SELFDASHBOARD_ENABLE_ENV_RESET` | empty | Required for that reset (ignored in production otherwise). |

**Performance** *(advanced, since 10/2026)*

| Variable | Default | Purpose |
|---|---|---|
| `SELFDASHBOARD_PLUGIN_READ_CACHE` | `1` | Central read cache for plugin APIs: answers within ~300 ms, refreshes in the background. Only for plugins that opt in via `plugin.json`; actions are never cached. `0` = off. |
| `SELFDASHBOARD_HOST_DOWN_MS` | `1` | Offline-host memory: unreachable LAN devices are answered instantly instead of ~3 s each time; checked again every 15 s. `0` = off. |
| `SELFDASHBOARD_STALE_MAX_MS` | empty | Maximum age (ms) of cached data shown while refreshing. Empty = per plugin, `0` = fresh data only. |

**Troubleshooting** *(advanced)*

| Variable | Default | Purpose |
|---|---|---|
| `SELFDASHBOARD_TIMING_LOG` | empty | `1` logs every plugin request with its duration. |
| `SELFDASHBOARD_TIMING_SLOW_MS` | `500` | Requests slower than this always appear in the container log. |
| `SELFDASHBOARD_SKIP_CHOWN` | empty | `1` = don't set volume ownership to PUID/PGID on start. |
| `SELFDASHBOARD_FIX_CROWDSEC_PERMS` | empty | `0` = don't add read permissions on `/crowdsec-data`. |

Full list of all variables: [README → Configuration](../README.md#en-configuration).

### Updates

1. **Docker → Check for updates** (image `:latest`) or let your update tool do it.
2. **Plugin Store → Update all**, then **Ctrl+F5**.
3. Existing containers: new template fields appear after **Edit** on the container. None of them is required — unset fields behave like the defaults above.

### Backup

Back up `/mnt/user/appdata/selfdashboard` completely (including `blobs/`, `auth/`, `.secret-salt`) and keep your Secret Key in a password manager.

### Troubleshooting

<a id="en-tls"></a>

**Self-signed HTTPS (`NODE_TLS_REJECT_UNAUTHORIZED`)** — Calendar (CalDAV), FRITZ!Box, Pi-hole, AdGuard and others call `https://` addresses from the container. With a self-signed certificate Node rejects them. Better than `0`: a valid certificate (Let's Encrypt, own CA) or `NODE_EXTRA_CA_CERTS`. `0` disables the check for **all** connections, including GitHub and Open-Meteo. Older installations may still have `NODE_TLS_REJECT_UNAUTHORIZED=0` under **Extra Parameters** — remove it there.

<a id="en-reset"></a>

**Forgot password** — set `SELFDASHBOARD_AUTH_RESET_PASSWORD` (min. 8 characters) **and** `SELFDASHBOARD_ENABLE_ENV_RESET=1`, restart, log in, then clear **both** and restart again.

**Widget shows `private_ip_blocked` / `blocked_url`** — `SELFDASHBOARD_ALLOW_PRIVATE_URLS` must be `1`.

**Docker widget: `EACCES`** — adjust `--group-add=281` under **Extra Parameters** to the socket's group: `stat -c '%g' /var/run/docker.sock`.

**Widget says "unreachable" although the device is back** — the offline-host memory checks every 15 s; at the latest after the next refresh it works again. Persistent: check the address in the widget settings.

---

<a id="deutsch"></a>

## 🇩🇪 Deutsch

### Installieren

1. **Docker → Container hinzufügen → Vorlage**, oben stehende Template-URL eintragen (oder über Community Applications installieren).
2. Die zwei Pfade prüfen, einen **Secret Key** setzen, übernehmen.
3. `http://<unraid-ip>:3000` öffnen und das Admin-Konto anlegen.
4. **Plugin-Store → Von GitHub** — gewünschte Widgets installieren, danach **Strg+F5**.

### Pfade

| Container | Host (Standard) | Zweck |
|---|---|---|
| `/app/data` | `/mnt/user/appdata/selfdashboard` | Dashboards (`users/`), Bilder aus Widget-Einstellungen (`blobs/`), Login (`auth/auth.db`), Kalender, Logs, Schlüsseldateien (`.calendar-key`, `.secret-salt`) |
| `/app/plugins/custom` | `/mnt/user/appdata/selfdashboard/plugins` | Installierte Plugins (`plugin.json`, `widget.js`, `server.mjs`) |
| `/crowdsec-data` *(optional, ro)* | z. B. `/mnt/user/appdata/crowdsec/data` | `crowdsec.db` und optional `GeoLite2-*.mmdb` für das CrowdSec-Widget |
| `/var/run/docker.sock` *(optional, ro)* | `/var/run/docker.sock` | Docker-Widget (nur dieser Host) |

### Variablen

Mit den Standardwerten des Templates läuft alles. Felder mit *erweitert* erscheinen erst unter **Weitere Einstellungen anzeigen**.

**Grundlagen**

| Variable | Standard | Zweck |
|---|---|---|
| `SELFDASHBOARD_SECRET_KEY` | leer | **Dringend empfohlen.** Fester Schlüssel für alle gespeicherten Zugangsdaten (Kalender, E-Mail, Widget-Passwörter). Einmal setzen, **nie ändern** — sonst sind gespeicherte Passwörter unlesbar. |
| `SELFDASHBOARD_ALLOW_PRIVATE_URLS` | `1` | Widgets dürfen LAN-IPs erreichen (`192.168.x`, `10.x`, `172.16–31.x`). Im Heimnetz auf `1` lassen; leer/`0` blockiert sie (`private_ip_blocked`). |
| `TZ` | `Europe/Berlin` | Zeitzone |
| `PUID` / `PGID` *(erweitert)* | `99` / `100` | Benutzer/Gruppe der App. Mit CrowdSec: dieselben Werte wie der CrowdSec-Container. |
| `SELFDASHBOARD_PLUGINS_GITHUB_REPO` / `_REF` / `_PATH` | `s3lfcod3r/selfdashboard` / `main` / `plugins-pack` | Quelle des Plugin-Stores. Normalerweise nicht ändern. |

**Sicherheit** *(erweitert)*

| Variable | Standard | Zweck |
|---|---|---|
| `SELFDASHBOARD_SECURE_COOKIES` | leer | Auf `1`, sobald das Dashboard über HTTPS läuft (Reverse-Proxy). |
| `SELFDASHBOARD_TRUST_PROXY` | leer | `1` **nur** hinter einem Reverse-Proxy, der `X-Forwarded-For` setzt. Ohne Proxy kann jeder diese Header fälschen. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | leer | `0` schaltet die Zertifikatsprüfung für **alle** ausgehenden HTTPS-Verbindungen ab — siehe [Selbstsigniertes HTTPS](#de-tls). |
| `SELFDASHBOARD_AUTH_RESET_PASSWORD` / `_USER` | leer | Admin-Passwort zurücksetzen — siehe [Passwort vergessen](#de-reset). |
| `SELFDASHBOARD_ENABLE_ENV_RESET` | leer | Nötig für diesen Reset (sonst im Produktivbetrieb ignoriert). |

**Geschwindigkeit** *(erweitert, seit 10/2026)*

| Variable | Standard | Zweck |
|---|---|---|
| `SELFDASHBOARD_PLUGIN_READ_CACHE` | `1` | Zentraler Lese-Cache für Plugin-APIs: Antwort in ~300 ms, neu geladen wird im Hintergrund. Nur für Plugins, die das in ihrer `plugin.json` freigeben; Aktionen werden nie gecacht. `0` = aus. |
| `SELFDASHBOARD_HOST_DOWN_MS` | `1` | Offline-Merker: Nicht erreichbare LAN-Geräte werden sofort beantwortet statt jedes Mal nach ~3 s; alle 15 s wird erneut geprüft. `0` = aus. |
| `SELFDASHBOARD_STALE_MAX_MS` | leer | Höchstalter (ms) zwischengespeicherter Daten, die während des Neuladens gezeigt werden. Leer = je Plugin, `0` = nur frische Daten. |

**Fehlersuche** *(erweitert)*

| Variable | Standard | Zweck |
|---|---|---|
| `SELFDASHBOARD_TIMING_LOG` | leer | `1` schreibt jede Plugin-Anfrage mit Dauer ins Log. |
| `SELFDASHBOARD_TIMING_SLOW_MS` | `500` | Langsamere Anfragen stehen immer im Container-Log. |
| `SELFDASHBOARD_SKIP_CHOWN` | leer | `1` = beim Start keine Besitzer auf PUID/PGID setzen. |
| `SELFDASHBOARD_FIX_CROWDSEC_PERMS` | leer | `0` = keine Leserechte auf `/crowdsec-data` ergänzen. |

Vollständige Liste aller Variablen: [README → Konfiguration](../README.md#de-konfiguration).

### Updates

1. **Docker → Nach Updates suchen** (Image `:latest`) oder das Update-Werkzeug machen lassen.
2. **Plugin-Store → Alle aktualisieren**, danach **Strg+F5**.
3. Bestehende Container: Neue Template-Felder erscheinen beim **Bearbeiten** des Containers. Keines davon ist Pflicht — nicht gesetzte Felder verhalten sich wie die Standardwerte oben.

### Sicherung

`/mnt/user/appdata/selfdashboard` komplett sichern (inklusive `blobs/`, `auth/`, `.secret-salt`) und den Secret Key im Passwort-Manager aufbewahren.

### Fehlerbehebung

<a id="de-tls"></a>

**Selbstsigniertes HTTPS (`NODE_TLS_REJECT_UNAUTHORIZED`)** — Kalender (CalDAV), FRITZ!Box, Pi-hole, AdGuard und andere rufen aus dem Container `https://`-Adressen auf. Bei einem selbstsignierten Zertifikat lehnt Node sie ab. Besser als `0`: ein gültiges Zertifikat (Let's Encrypt, eigene CA) oder `NODE_EXTRA_CA_CERTS`. `0` schaltet die Prüfung für **alle** Verbindungen ab, auch für GitHub und Open-Meteo. Ältere Installationen haben eventuell noch `NODE_TLS_REJECT_UNAUTHORIZED=0` unter **Extra Parameters** — dort entfernen.

<a id="de-reset"></a>

**Passwort vergessen** — `SELFDASHBOARD_AUTH_RESET_PASSWORD` (min. 8 Zeichen) **und** `SELFDASHBOARD_ENABLE_ENV_RESET=1` setzen, neu starten, einloggen, dann **beide** leeren und erneut starten.

**Widget meldet `private_ip_blocked` / `blocked_url`** — `SELFDASHBOARD_ALLOW_PRIVATE_URLS` muss `1` sein.

**Docker-Widget: `EACCES`** — `--group-add=281` unter **Extra Parameters** an die Gruppe des Sockets anpassen: `stat -c '%g' /var/run/docker.sock`.

**Widget meldet „nicht erreichbar“, obwohl das Gerät wieder läuft** — der Offline-Merker prüft alle 15 s; spätestens nach der nächsten Aktualisierung geht es wieder. Bleibt es dabei: Adresse in den Widget-Einstellungen prüfen.
