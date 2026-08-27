# NetzWacht

Netzwerk-Wächter-Widget: zeigt Live-Durchsatz, aktive Geräte und Suricata-Sicherheitsalarme
vom NetzWacht-Stack (ntopng + Suricata auf dem ZimaBoard, gespeist vom Fritzbox-Mitschnitt).

## Datenquellen

| Quelle | Was | Auth |
|--------|-----|------|
| ntopng REST v2 (`/lua/rest/v2/...`) | Durchsatz, Gerätezahl, Top-Geräte | HTTP Basic (ntopng-Benutzer) |
| NetzWacht-Alarm-API (Port 3001) | Suricata-Alarme + 24h-Zusammenfassung | Header `X-Api-Token` |

Beide Abfragen laufen serverseitig über `/api/plugins/netzwacht` (POST) — Zugangsdaten
bleiben im Dashboard. Antworten werden 5 s gecacht, damit mehrere Browser ntopng nicht fluten.

## Konfiguration

- **ntopng-URL** — z. B. `http://192.168.1.103:3000`
- **ntopng-Benutzer / -Passwort** — Dashboard-Login von ntopng
- **Alarm-API-URL** (optional) — z. B. `http://192.168.1.103:3001`
- **Alarm-API-Token** (optional) — steht auf dem ZimaBoard in `/media/Safe-Storage/netwatch/api.env`
- **Max. Meldungen** — wie viele Alarme die Liste zeigt (1–25)

Ohne Alarm-API-Angaben zeigt das Widget nur die ntopng-Werte und einen Hinweis.

## Fehlerbilder

- `ntopng-Login abgelehnt` — Benutzer/Passwort prüfen; ntopng antwortet bei falscher
  Basic-Auth mit einem Redirect auf die Login-Seite.
- `Alarm-API: Token abgelehnt` — Token aus `api.env` erneut kopieren, Container
  `netwatch-alertapi` läuft?

## Hintergrund

Aufbau des Gesamt-Stacks (Capture-Container, Rausch-Filterung, Grenzen des
Fritzbox-Mitschnitts): siehe NetzWacht-Handbuch im Projekt-Wiki/Artifact.
