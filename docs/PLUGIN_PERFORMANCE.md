# Plugin-Performance — Leitfaden für Entwickler

SelfDashboard lädt Widgets vom **Volume** (`widget.js` / `widget.css`) und ruft APIs über `/api/plugins/<id>/…` auf. Viele Kacheln oder große Bundles verlangsamen den ersten Seitenaufbau spürbar.

Dieser Leitfaden fasst zusammen, **worauf du als Plugin-Autor achten solltest**, damit dein Plugin schnell lädt und sich gut in das Dashboard einfügt.

Verwandte Docs: **[PLUGIN_DEV.md](./PLUGIN_DEV.md)** · **[PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md)**

---

## Kurzüberblick: Drei Ebenen

| Ebene | Was du lieferst | Was SelfDashboard macht |
|-------|-----------------|-------------------------|
| **1. Assets** | Kleines `widget.js`, optionales `widget.css`, `version` in `plugin.json` | Alle Widgets eines Dashboards in **einer** Anfrage (Widget-Bundle), Browser-Cache per Version |
| **2. Widget-Daten** | `pluginApiJsonWithStale`, sinnvolle Poll-Intervalle, optional **`readCache`** in `plugin.json` | Stale-Cache in `sessionStorage`; zentraler Lese-Cache im Server |
| **3. Server-API** | Kurze Handler, keine langen synchronen Aufrufe, Stale-Cache + Invalidierung | Offline-Merker für nicht erreichbare Hosts, Server-Timing |

**Messen statt raten:** siehe [Abschnitt 11](#11-messen-perf-bericht--timing).

---

## 1. Widget-Bundle klein halten

### Nicht selbst bundeln — Host-Bridge nutzen

Beim Build (`npm run build:plugin-pack`) werden schwere Abhängigkeiten **externalisiert**. Dein `widget.js` soll nur deine Plugin-Logik enthalten.

| Import in `index.tsx` | Im Bundle? | Stattdessen |
|----------------------|------------|-------------|
| `react` / `react-dom` | Nein | Automatisch über `globalThis.SelfDashboard` |
| `lucide-react` | Nein | Automatisch über `SelfDashboard.LucideReact` |
| `@/lib/store` (`useDashboardStore`) | Nein | Host-Zustand-Bridge |
| `@/lib/pluginDev` | Nein | Host-API-Bridge |
| `@/lib/pluginLocale`, `@/lib/i18n` | Nein | Host-Bridge |

**Richtig:**

```tsx
import { Copy, RefreshCw } from 'lucide-react'
import { pluginApiJson, pluginApiJsonWithStale, reportPluginCatch } from '@/lib/pluginDev'
import { useDashboardStore } from '@/lib/store'
```

**Falsch:**

```tsx
import * as React from 'react'          // eigene React-Kopie → groß + Fehler
import { Shield } from 'lucide-react/dist/esm/icons/shield'  // Deep-Import umgeht Shim
import { create } from 'zustand'         // eigener Store
import axios from 'axios'                // nur wenn wirklich nötig — Bundle wächst
```

### Lucide-Icons

Nur Icons verwenden, die der Host bereitstellt (`src/lib/pluginLucideBridge.ts`). Fehlt ein Icon:

- PR/Issue mit Icon-Name, **oder**
- kleines inline SVG / Emoji statt neues npm-Paket

### CSS auslagern

Styles in **`widget.css`** neben dem Plugin ablegen, nicht große CSS-Strings in JS. Der Loader lädt CSS und JS **parallel**.

### Größen als Richtwert

| Größe `widget.js` | Einschätzung |
|-------------------|--------------|
| &lt; 30 KB | Sehr gut |
| 30–60 KB | OK |
| 60–100 KB | Prüfen: unnötige Libs? |
| &gt; 100 KB | Dringend optimieren (Lucide/React/Store prüfen) |

Build lokal testen:

```bash
npm run build:plugin-pack -- meinplugin
# Größe prüfen: plugins-pack/meinplugin/widget.js
```

Der Build setzt **`minify: true`**. Quellen (`index.tsx`) im Repo behalten, `widget.js` committen.

---

## 2. Version & Browser-Cache

SelfDashboard lädt Assets im Normalfall gebündelt, einzeln nur als Rückfall:

```text
/api/plugins/widgets-bundle?type=js&ids=<id,id,…>&v=<Hash über alle Versionen>
/api/plugins/widgets-bundle?type=css&ids=<nur Plugins mit widget.css>&v=…
/api/plugins/custom-assets/<id>/widget.js?v=<plugin.json version>   (Rückfall)
```

### Pflicht bei jedem Release

**`version` in `plugin.json` erhöhen** (z. B. `1.0.0` → `1.0.1`).

- Stimmt `?v=` mit der installierten Version überein → Browser darf **1 Jahr** cachen (`immutable`). Beim Bundle fließen alle Versionen in den Hash ein.
- Stimmt sie nicht → `no-store` (kein Cache).
- Der Plugin-Store bietet bestehenden Installationen ein Update **nur bei höherer Version** an — auch wenn sich nur `server.mjs` geändert hat.

Ohne Versions-Bump laden Nutzer nach Update oft noch altes JS, bis Hard-Reload.

### Nach Store-Update

Nutzer: **Aktualisieren** im Plugin-Store, dann **Strg+F5**.

---

## 3. Lade-Reihenfolge im Dashboard

SelfDashboard lädt Volume-Plugins **gestaffelt und gebündelt**:

1. **Priorität:** ein Bundle mit allen Plugins des **aktiven Dashboards** (+ globale Plugins wie `mail` für die Navbar)
2. **`ready`:** Dashboard wird nutzbar
3. **Deferred:** ein zweites Bundle mit den Plugins der anderen Dashboards

Im Bundle läuft **jedes Widget gekapselt** (eigene Funktion + `try/catch`): wirft dein Code beim Laden, laufen die anderen Widgets weiter. Syntaxfehler erkennt der Server schon beim Zusammenbauen und lässt das Widget weg. Was im Bundle scheitert, lädt der Client **einzeln** nach — dann erscheint der Fehler wie gewohnt im Protokoll.

`registerPlugin` meldet Änderungen gebündelt (einmal pro Skript), nicht pro Aufruf — egal wie viele Plugins im Bundle stecken, das Dashboard rendert danach **einmal**.

**Automatisch, ohne Zutun des Plugins:**

| Was | Wirkung |
|-----|---------|
| Bundle in Teile von ~300 KB | Jeder Teil läuft als eigene Aufgabe — der Browser kann dazwischen zeichnen (wichtig bei vielen Plugins) |
| Übersetzen + Minifizieren | Der Server übersetzt jedes `widget.js` für ältere WebViews (ES2017) und **minifiziert unminifizierte Builds automatisch** (einmal pro Inhalt, Ergebnis gecacht) |
| Cache pro Widget | Neue Plugin-Kombinationen werden aus fertigen Abschnitten zusammengesetzt |
| Kacheln außerhalb des Sichtfelds | Werden erst eingehängt, wenn man in ihre Nähe scrollt (keine Renderzeit, keine Datenabrufe vorher). Im Bearbeitungsmodus sofort. Abschalten: `localStorage.setItem('sd:noLazyWidgets', '1')` |

Trotzdem lohnt ein sauberer, minifizierter Build: der Server-Durchlauf kostet beim ersten Abruf Zeit, und Bundle-Größe zählt beim Einlesen im Browser (Spalte `KB` im [Perf-Bericht](#11-messen-perf-bericht--timing)).

Widgets sind **memoisiert**: Sie rendern nur neu, wenn sich ihre eigenen Props (`config`, `theme`, `layoutMode`, `editMode`) ändern oder ihr eigener Zustand bzw. ein Store-Abo es auslöst — nicht, weil das Dashboard drumherum neu rendert. Daten deshalb im Widget-Zustand halten, nicht darauf verlassen, dass der Host regelmäßig neu rendert.

Zum Debuggen ohne Bundle: `localStorage.setItem('sd:noBundle', '1')` in der Browser-Konsole, dann neu laden.

### Was du daraus ableiten solltest

| Tipp | Warum |
|------|--------|
| Widget soll **sofort rendern** (Skeleton/„Lade…“), nicht auf deferred Scripts warten | Anderes Dashboard kann dein Plugin schon registriert haben |
| Keine schweren **Sync-Imports** oben in `index.tsx` | Blockiert Parse/Execute beim Script-Load — für **alle** Widgets im selben Bundle |
| **Kein** globales `fetch` beim Modul-Start | Lieber in `useEffect` / nach erstem Paint |
| Navbar-Plugins sparsam halten | `mail` wird immer mitgeladen |

Du steuerst die Priorität **nicht** selbst — sie kommt aus der Dashboard-Konfiguration des Nutzers.

---

## 4. API-Daten im Widget (Client)

### `pluginApiJsonWithStale` für Dashboard-Daten

Für Daten, die sich sekündlich ändern müssen, aber beim Reload **sofort** sichtbar sein sollen:

```tsx
import { pluginApiJsonWithStale } from '@/lib/pluginDev'

const data = await pluginApiJsonWithStale<MyType>('meinplugin', '/status', {
  timeoutMs: 15_000,
  staleMaxAgeMs: 60_000, // Default: 60 s — letzte Antwort aus sessionStorage
})
```

**Ablauf:**

1. Gibt es frischen Cache (&lt; `staleMaxAgeMs`) → **sofort anzeigen**, Fetch im Hintergrund
2. Sonst → normal warten, Ergebnis cachen

**Eignet sich für:** Status-Übersichten, Listen, Metriken  
**Weniger für:** Formulare, einmalige Aktionen, Entsperren/Löschen → `pluginApiJson`

### Poll-Intervalle

```tsx
useEffect(() => {
  void load()
  const id = window.setInterval(() => void load(), refreshSeconds * 1000)
  return () => window.clearInterval(id)
}, [refreshSeconds])
```

| Intervall | Empfehlung |
|-------------|------------|
| &lt; 5 s | Nur bei Live-Daten (Container-Stats o. ä.) |
| 15–60 s | Typisch für Status-Widgets |
| &gt; 60 s | Statische/quasi-statische Quellen |

Intervall in **Settings konfigurierbar** machen (Default konservativ).

### Direkte Fremd-APIs (Emby, Unraid, …)

Kein SelfDashboard-Server → du implementierst Stale-Cache **selbst** (z. B. `sessionStorage` wie in `plugins-pack/unraid/widget.js`), sonst jeder Reload = voller Roundtrip.

### Zentraler Lese-Cache: `readCache` in `plugin.json`

Der Server kann Lese-Anfragen deines Plugins zwischenspeichern — **ohne Code im Plugin**. Du erklärst in `plugin.json`, welche Anfragen nur lesen:

```json
"readCache": { "methods": ["POST"], "readActions": [null, "status", "history"] }
```

| Feld | Bedeutung |
|------|-----------|
| `methods` | `"GET"` und/oder `"POST"` — nur diese Methoden werden gecacht |
| `readActions` | nur bei POST: erlaubte Werte von `body.action`; `null` = Body ohne `action`. Fehlt das Feld, gilt **jeder** POST als lesend |
| `"readCache": false` | ausdrücklich abschalten |

**Verhalten:** Ist die letzte Antwort älter als 2 s, lädt der Server frisch, wartet aber **höchstens 300 ms**. Kommt der Upstream schneller → frische Daten; sonst sofort die letzte Antwort (bis 10 min alt), das Laden läuft im Hintergrund weiter. Gecacht werden nur 2xx-Antworten, getrennt nach Nutzer, Pfad, Query und Body. **Jede nicht gecachte Anfrage an dein Plugin** (z. B. eine Schalt-Aktion) leert den Cache, damit der neue Zustand sofort sichtbar ist. Antwort-Header: `X-SD-Cache` (`hit|refresh|stale|miss`), `X-SD-Data-Age` (Sekunden).

**Nicht verwenden** für: Aktionen (schalten, löschen, starten), Widgets, die **Raten aus der Differenz zweier Abfragen** rechnen (Bytes/s, Token/s — alte Werte verfälschen die Rate), Live-Bilder, Plugins mit eigenem Server-Cache. Plugins ohne `readCache` werden **nie** gecacht.

---

## 5. Server-API (Builtin-Handler)

Server-Code liegt in **`src/builtin-plugins/<id>/`** und braucht ein **neues Docker-Image**. Widget-Only-Updates reichen dafür nicht.

### Stale-while-revalidate für teure Abfragen

Statt eines reinen TTL-Caches (nach Ablauf wartet der Nutzer wieder die volle Zeit) lieber **Stale-while-revalidate**: ältere Daten sofort liefern, im Hintergrund auffrischen.

```ts
import { createPluginStaleCache, staleCacheKey } from '@/lib/pluginStaleCache'

const cache = createPluginStaleCache({ freshMs: 10_000, staleMs: 10 * 60_000, label: 'meinplugin' })

// Lesen: Antwort kommt aus dem Cache oder vom Loader (nur 2xx wird gespeichert)
return cache.respond(staleCacheKey(url, user, body.password), () => loadStatus(url))
// Schreibende Aktion: cache.clear()
```

Optional `maxWaitMs` (z. B. `300`): erst kurz auf frische Daten warten, dann die alte Antwort. Für volume-`server.mjs` kommt das Modul aus `plugins-pack/_shared/plugin-stale-cache.ts` (Build mappt `@/lib/pluginStaleCache` automatisch). Der einfache TTL-Cache (`createPluginServerCache`) bleibt verfügbar.

**Beispiele im Repo:** `docker` (Liste, 5 s frisch), `crowdsec` (20 s frisch, 30 min stale), `adguard`, `netzwacht`, `openclaw-status`.

### Ausgehende Requests: gemeinsame Helfer nutzen

Rufe Upstreams **immer** über `fetchWithSsrfGuard` (`_shared/ssrf.ts`) bzw. `fetchChecked` (`_shared/insecure-fetch.ts`) auf. Neben dem SSRF-Schutz bekommst du damit den **Offline-Merker**: Ist ein Host nicht erreichbar (`EHOSTUNREACH` u. ä., im LAN erst nach ~3 s), werden weitere Anfragen an ihn **sofort** abgelehnt (`UpstreamHostDownError`) und eine TCP-Probe prüft im Hintergrund alle 15 s, ob er wieder da ist. Dein `catch` behandelt das wie jeden Verbindungsfehler.

### Nichts Synchrones, das lange läuft

Node hat **einen** Haupt-Thread: Was dort synchron läuft (z. B. `better-sqlite3`-Abfragen, große `JSON.parse`, `transformSync`), blockiert **alle** anderen Anfragen — auch die anderer Plugins. Teure synchrone Arbeit gehört in einen `worker_thread`; Vorbild: `crowdsec` (`lib/crowdsecWorker.ts` + `crowdsecDashboardRunner.ts`, Build-Schritt `scripts/build-server-workers.mjs`).

### Regeln

| Do | Don't |
|----|-------|
| Cache-Key aus **Request-Parametern** bilden | Ein Key für alle Nutzer/Konfigurationen |
| Cache nach **Mutation** invalidieren | Alte Liste nach „Container stoppen“ |
| TTL per **Env** dokumentieren | Minutenlanger Cache ohne Hinweis |
| Fehler **nicht** cachen | 500er 20 s lang servieren |

---

## 6. UI-Verhalten

- **Loading-State:** Skeleton oder kompaktes „Lade…“, kein leeres Widget
- **Fehler:** `reportPluginCatch('meinplugin', e)` — nicht nur `console.error`
- **Keine Layout-Shifts:** feste Min-Höhen für Zahlen/Icons wo möglich
- **Unveränderte Daten nicht neu setzen:** liefert ein Poll dieselben Daten, `setState` überspringen (z. B. Vergleich per `JSON.stringify` mit der letzten Antwort) — sonst rendert das ganze Widget bei jedem Poll neu
- **Lange Listen portionsweise rendern** (ab ~50–100 Einträgen): erst z. B. 60, beim Scrollen per `IntersectionObserver`-Marker am Listenende nachladen — Vorbild `crowdsec` (`FEED_PAGE`)
- **Kein Layout lesen direkt nach dem Einfügen** (`getBoundingClientRect`, `offsetWidth` in Effekten oder Timern) — erzwingt einen Reflow des ganzen Dashboards. Größen per `ResizeObserver` messen (Callback läuft nach dem Layout)
- **Bilder:** klein halten, SVG bevorzugen; große PNGs nicht ins Bundle und **nicht als `data:`-URI in die Kachel-Konfiguration** — die landet in `dashboard.json` und wird bei jedem Seitenaufruf komplett geladen (Ausnahme: `bookmarks`, dort lagert der Server Icons automatisch aus)

---

## 7. Checkliste vor Release

- [ ] `plugin.json` **`version` erhöht**
- [ ] `widget.js` neu gebaut (`npm run build:plugin-pack -- <id>`)
- [ ] `widget.js` **&lt; ~60 KB** (Ziel) oder Begründung dokumentiert
- [ ] Kein eigenes React / Zustand / Lucide-Bundle
- [ ] Styles in `widget.css`, wenn &gt; wenige Zeilen
- [ ] Dashboard-Daten: `pluginApiJsonWithStale` oder bewusst `pluginApiJson`
- [ ] Poll-Intervall ≥ 15 s (Default), in Settings änderbar
- [ ] `readCache` in `plugin.json` gesetzt (nur Lese-Aktionen!) oder bewusst weggelassen
- [ ] Server: Stale-Cache + Invalidierung bei Schreibaktionen; Upstreams über `fetchWithSsrfGuard`/`fetchChecked`
- [ ] Kein langer synchroner Code im Server-Handler
- [ ] [Perf-Bericht](#11-messen-perf-bericht--timing) zeigt dein Widget nicht oben in der Liste
- [ ] Getestet: Store-Update → Strg+F5 → Widget sichtbar

---

## 8. Typische Anti-Patterns

| Problem | Symptom | Lösung |
|---------|---------|--------|
| Kein Version-Bump | Nutzer sehen altes Widget | `version` in `plugin.json` |
| Lucide/React im Bundle | `widget.js` &gt; 80 KB | Imports wie oben; neu bauen |
| `fetch` in Modul-Top-Level | Langsamer Start, Doppel-Requests | `useEffect` |
| Poll alle 1 s | Hohe Server-Last | Intervall + Server-Cache |
| Riesige JSON-Antworten | Träge API | Limit/Pagination im Handler |
| Alles in einer TS-Datei | Schwer wartbar | Split OK — Build bundelt; Größe zählt |
| `setState` bei jedem Poll | Widget rendert ständig, Browser ruckelt | Nur bei geänderten Daten setzen |
| Hunderte Listeneinträge auf einmal | Hunderte ms Renderzeit | Portionsweise rendern |
| Synchrone DB-/JSON-Arbeit im Handler | Ganzer Server hängt, alle Widgets warten | `worker_thread` |
| Große `data:`-Bilder in der Konfiguration | Langsamer Seitenstart für alle Widgets | Bild-URL oder kleine Icons |

---

## 9. Referenz-Plugins im Repo

| Plugin | Gut für |
|--------|---------|
| **crowdsec** | TSX-Quellen, `pluginApiJsonWithStale`, Server-Stale-Cache, Worker-Thread, portionsweise Liste, `widget.css` |
| **unraid** | Stale-Cache bei direkter GraphQL-API ohne Builtin-Server |
| **docker** | Stale-Cache, Invalidierung nach Container-Aktion, Host-Guard (`requireFullAdmin`) im Volume-Server |
| **shelly-plug** / **hue** | `readCache` mit Lese- und Schalt-Aktionen |
| **clock** / **iframe** | Kleine Bundles als Größen-Vorbild |

---

## 10. Umgebungsvariablen (Server-Cache)

| Variable | Default | Wirkung |
|----------|---------|---------|
| `CROWDSEC_DASHBOARD_CACHE_MS` | 20000 | crowdsec: so lange gilt die Auswertung als frisch |
| `DOCKER_LIST_CACHE_MS` | 5000 | docker: so lange gilt die Container-Liste als frisch |
| `SELFDASHBOARD_PLUGIN_READ_CACHE` | an | `0` schaltet den zentralen Lese-Cache (`readCache`) ab |
| `SELFDASHBOARD_STALE_MAX_MS` | je Cache | Höchstalter für Stale-Antworten global überschreiben (`0` = nur frische) |
| `SELFDASHBOARD_HOST_DOWN_MS` | an | `0` schaltet den Offline-Merker ab |
| `SELFDASHBOARD_TIMING_LOG` | aus | `1` loggt jede gemessene Plugin-Anfrage (sonst nur langsame) |
| `SELFDASHBOARD_TIMING_SLOW_MS` | 500 | Ab dieser Dauer (ms) wird eine Anfrage immer geloggt |

Eigene Plugins: analog `MEINPLUGIN_*_CACHE_MS` in README dokumentieren.

---

## 11. Messen: Perf-Bericht & Timing

**Im Browser** (F12 → Konsole), etwa 10 s nach dem Laden:

- `[SelfDashboard][timing] Plugins geladen …` — Zeit bis Bundle/Widgets bereit
- `[SelfDashboard][perf] …` — **Perf-Bericht**: Render-Zeit und Effekte **pro Widget**, Blockaden des Browsers nach Verursacher (Widget, Dashboard-Kern, Browser-Erweiterung) inkl. erzwungener Reflows, längste Frames. Kopieren: `copy(__sdPerfReport.text)`
- Tabelle der langsamsten API-Aufrufe mit **Server-Timing** (wie lange der Server selbst brauchte)
- Jede Anfrage einzeln loggen: `localStorage.setItem('sd:timing', '1')`

Render-Zeiten pro Widget gibt es nur, weil das Image mit `next build --profile` gebaut wird; Blockade-Zuordnung braucht Chromium/Edge ≥ 123.

**Auf dem Server:** `docker logs selfdashboard 2>&1 | grep timing` — langsame Plugin-Anfragen mit Aufteilung (`auth`, `servers-wait`, `handler`, `cache=`), Ladezeiten der `server.mjs` beim Start, Offline-Meldungen (`[upstream]`). Jede `/api/plugins/…`-Antwort trägt einen `Server-Timing`-Header (DevTools → Network → Timing).

---

## 12. Zusammenfassung

1. **Klein bundeln** — Host-Bridge nutzen, CSS separat, minifiziert bauen  
2. **Version bumpen** — Browser-Cache und Store-Updates funktionieren zuverlässig  
3. **Stale-Cache** — schnelle Anzeige nach Reload (`pluginApiJsonWithStale`, `readCache`)  
4. **Server entlasten** — Stale-Cache, gemeinsame Fetch-Helfer, nichts lange Synchrones  
5. **Erst rendern, dann laden** — kein schwerer Code beim Script-Start, nur bei geänderten Daten neu rendern  
6. **Messen** — Perf-Bericht und Server-Timing zeigen, wo die Zeit hingeht  

Fragen oder fehlende Lucide-Icons: Issue/PR im [SelfDashboard-Repo](https://github.com/s3lfcod3r/selfdashboard) — am besten mit Plugin-ID und Icon-Namen.
