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

## Detail-Popup

**Ein Klick auf eine Zeile** öffnet ein Fenster mit allem zu dieser Steckdose —
die Kachel selbst bleibt unverändert. Der Punkt schaltet weiterhin, geklickt
wird also überall sonst in der Zeile.

Im Popup:

- **Live-Werte**: Leistung, Spannung, Strom, Gerätetemperatur, heute und
  laufender Monat. Der Schalter ist auch hier.
- **Zeitraum frei wählbar** über Von/Bis, dazu Schnellwahl für 24 Stunden,
  7 Tage und 30 Tage.
- **Auflösung** umschaltbar zwischen **Stunden** und **Tagen**.
- **Darstellung**: Diagramm und Liste lassen sich einzeln zu- und abschalten —
  nur Diagramm, nur Liste oder beides. Eines von beiden bleibt immer an.
- **Summe**, **Spitzenwert** je Stunde bzw. Tag und die Anzahl der Werte.

Grenzen, die das Popup selbst anzeigt: Der Verlauf reicht **40 Tage** zurück,
ältere Zeiträume werden auf diesen Rand gekürzt und das wird vermerkt. Über
1200 Werte pro Abfrage lehnt der Server ab — 40 Tage stündlich sind 960, passt
also; wer mehr will, schaltet auf Tage.

Die Abfrage geht **nicht** ans Gerät, sondern nur an die gespeicherten
Zählerstände. Sie funktioniert also auch, wenn die Steckdose gerade nicht
erreichbar ist.

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

### Wake-on-LAN

Hängt an einer Steckdose ein Rechner oder Server, der sich selbst herunterfährt,
kann die Kachel ihn wieder starten: Unter der Zeile in den Einstellungen die
**MAC-Adresse** seiner Netzwerkkarte eintragen.

- Ist die Steckdose **an**, das Gerät zieht aber **unter 3 W** (heruntergefahren),
  erscheint in der Zeile und im Popup ein rundes **Power-Symbol**.
- Ein Klick schickt ein **Wake-on-LAN-Paket** (Magic Packet, UDP-Broadcast an
  Port 9 und 7). Danach dreht sich dort ein Ladekreis und die Zeile zeigt
  **„startet"**, bis die Steckdose wieder
  Verbrauch misst, längstens 6 Minuten.
- Ist die Steckdose selbst **aus**, gibt es keinen Knopf — dann ist der Schalter
  der Weg.

> **Netzwerk:** Ein Broadcast verlässt kein Docker-Bridge-Netz. Der Container
> muss direkt im Heimnetz hängen (`host` oder macvlan/ipvlan, unter Unraid z. B.
> `br0`). Am Gerät muss Wake-on-LAN im BIOS und im Betriebssystem aktiv sein.

## Technik

- Status: `Switch.GetStatus?id=0` (`apower`, `voltage`, `current`,
  `aenergy.total`, `temperature.tC`, `output`).
- Schalten: `Switch.Set?id=0&on=true|false`.
- Popup-Verlauf: `POST /api/plugins/shelly-plug` mit
  `{ action: 'history', device, from, to, unit: 'hour'|'day' }` — antwortet aus
  der lokalen Verlaufsdatei, ohne Geräteaufruf und ohne Passwort. Töpfe richten
  sich nach der lokalen Uhr (Tag = lokale Mitternacht).
- Wake-on-LAN: `POST /api/plugins/shelly-plug` mit `{ action: 'wake', device }`
  — Magic Packet an `device.mac`, Broadcast `255.255.255.255`, Ports 9 und 7.
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

**Click a row** to open a popup with the live readings and consumption over a
freely chosen range: from/to pickers plus 24 h / 7 d / 30 d shortcuts, an
hours-or-days resolution switch, and independent chart and list toggles. History
reaches back 40 days; the popup reads the stored counters only, so it works even
while the plug is offline.

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

**Wake-on-LAN:** give a plug the MAC of the machine behind it and the row (and
popup) shows a round **power button** whenever the plug is on but the machine draws under 3 W,
i.e. it has shut down. The button sends a magic packet (UDP broadcast, ports 9
and 7) and shows a spinner and *starting* until the plug sees load again, for up to 6
minutes. The broadcast cannot leave a Docker bridge network — run the container
on `host` or macvlan/ipvlan (Unraid `br0`), and enable WoL on the machine.

The container needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` to reach LAN devices.
Switching is restricted to logged-in dashboard users. History starts when you
set the plugin up — there is no retroactive data.
