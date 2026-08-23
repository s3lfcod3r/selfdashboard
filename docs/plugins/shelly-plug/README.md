# Shelly Plug

**Shelly Plug PM Gen3 / Plug S Gen3** (und andere Gen2+ Steckdosen) überwachen
**und schalten** — direkt über die lokale RPC-API, ohne Cloud, ohne API-Key.

Eine Kachel zeigt **mehrere Steckdosen** (bis zu 16), je eine Zeile pro Gerät.

## Ansicht

Zwei Layouts, umschaltbar in den Einstellungen:

**Kompakt** (Standard) — eine dichte Zeile je Steckdose: Statuspunkt, Name,
Monatswert (wenn der Verlauf aktiv ist) und Momentanleistung. Ab vier
Steckdosen legt die Kachel automatisch mehrere Spalten an, sobald sie breit
genug ist. Wird es eng, kürzt der **Name** mit Auslassungspunkten — die Zahlen
bleiben immer vollständig stehen und verschwinden auch beim Hineinzoomen nicht.
**Der Punkt ist der Schalter** — bei dieser Zeilenhöhe passt kein echter
Kippschalter.

**Detail** — die frühere Karte je Steckdose mit Verlaufskurve, Spannung, Strom,
Temperatur und den Werten für heute und den Monat. Sinnvoll bei ein bis zwei
Steckdosen oder wenn du die Kurve sehen willst.

Punktfarben: grün = an, grau = aus, rot = nicht erreichbar.

## Was es zeigt

Pro Steckdose:

- **Name** und **Momentanleistung** (W), in der Detailansicht zusätzlich
  Spannung, Strom und Geräte-Temperatur.
- **An/Aus-Schalter** (optional abschaltbar).
- Optionaler **kWh-Verlauf**: **heute** und **laufender Monat**.

Der Monatswert ist der **Kalendermonat** — er springt am 1. auf 0 zurück und ist
damit mit der Stromrechnung vergleichbar. Die Beschriftung nennt den Monat
(„Aug“, „Sep“), damit das ohne Erklärung erkennbar ist.

## Einrichtung

1. Shelly Plug ins WLAN bringen und die **IP-Adresse** notieren.
2. Widget hinzufügen → **Zahnrad** → Steckdosen mit **Name + IP** eintragen,
   eine Zeile je Gerät. Steckdosen werden ausschließlich hier gepflegt, die
   Kachel selbst zeigt nur an.
3. Nur falls am Gerät die **Authentifizierung** aktiv ist: Passwort eintragen
   (Benutzer ist bei Shelly immer `admin`). Sonst leer lassen.
4. „Schalten erlauben“ und „Verlauf speichern“ nach Wunsch.

### Aktualisieren

**0 bis 300 Sekunden.** Bei **0** lädt die Kachel einmal beim Öffnen und fragt
danach nicht mehr nach — sinnvoll, wenn die Steckdose ohnehin selten wechselt.
Kleine Werte gehen ebenfalls, fragen das Gerät aber entsprechend häufig ab.
Voreinstellung ist 10 Sekunden.

### Passwörter

Zwei Ebenen, damit beide Fälle sauber funktionieren:

- **Gemeinsames Passwort** (unten im Dialog) — gilt für alle Steckdosen, die
  kein eigenes haben. Der Normalfall, wenn überall dasselbe Passwort gesetzt ist.
- **Passwort je Steckdose** (Feld unter jeder Zeile) — hat Vorrang. Nötig, wenn
  die Geräte unterschiedliche Passwörter haben.

> **Ablage:** Beide Passwörter stehen derzeit **unverschlüsselt** in der
> Dashboard-Konfiguration, zugänglich nur für angemeldete Nutzer. Grund und
> Historie stehen in `src/lib/widgetSecrets.ts`.

> **LAN-Zugriff:** Der SelfDashboard-Server ruft das Gerät direkt im Heimnetz
> auf. Dazu muss am Container `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` gesetzt sein,
> sonst meldet das Widget „LAN blockiert (SSRF)".
>
> **Schalten** ist nur für angemeldete Dashboard-Nutzer möglich (jeder
> Plugin-Aufruf läuft über die Login-Prüfung des Hosts).

## Technik

- Status: `Switch.GetStatus?id=0` (`apower`, `voltage`, `current`,
  `aenergy.total`, `temperature.tC`, `output`).
- Schalten: `Switch.Set?id=0&on=true|false`.
- Auth: HTTP Digest (RFC 7616, SHA-256), Benutzer fest `admin`.
- Verlauf: Zählerstands-Schnappschüsse im Daten-Volume; kWh je Zeitfenster =
  Summe positiver Deltas (zählerreset-fest). Aufbewahrung ~40 Tage, die letzten
  2 Tage minutengenau, älteres stündlich ausgedünnt.

> Der Verlauf beginnt mit der Einrichtung — **rückwirkend gibt es keine Daten**.
> Direkt nach dem Einbau steht beim Monatswert 0.

---

# Shelly Plug (English)

Monitor **and switch** sockets with the **Shelly Plug PM Gen3 / Plug S Gen3**
(and other Gen2+ plugs) via the local RPC API — no cloud, no key. One tile lists
**up to 16 plugs**, one row each.

**Two layouts**, switchable in settings. *Compact* (default) is one dense line
per plug — status dot, name, live watts — flowing into several columns from four
plugs up once the tile is wide enough; the dot doubles as the on/off button, and
the month kWh sits beside the watts whenever history is on. When space runs
short the *name* truncates — the figures always stay whole. *Detail* is the
per-plug card with sparkline, voltage, current, temperature and today/month.

**Shows per plug:** name, live power (W), voltage, current, device temperature,
an on/off toggle (optional) and an optional kWh history — **today** and the
**current calendar month** (resets on the 1st; the label names the month).

**Setup:** add each plug by name + IP in settings (the gear icon) — the tile
itself only displays, it has no add form. The refresh interval accepts **0–300
seconds**; at 0 the tile loads once and stops polling. Passwords work on two
levels:
a **shared password** for all plugs, and an optional **per-plug password** that
overrides it — needed when the devices use different passwords. The Shelly user
is always `admin`. See the German section above for how the two passwords are
stored.

The container needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` to reach LAN devices.
Switching is restricted to logged-in dashboard users. History starts when you
set the plugin up — there is no retroactive data.
