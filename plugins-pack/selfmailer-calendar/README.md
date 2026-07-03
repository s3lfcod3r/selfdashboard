# Plugin: SelfMailer Kalender (`selfmailer-calendar`)

[← Plugin index](README.md) · [Main catalog](../../README.md#plugins)

## Deutsch

### Kurzbeschreibung

Zeigt **kommende Termine aus SelfMailer** im Dashboard und legt **neue Termine direkt in
SelfMailer** an. Wählst du als Ziel einen Google-Kalender, schiebt SelfMailer den Termin
automatisch auch nach Google. SelfMailer bleibt die **einzige Datenquelle** — das Dashboard
hat keinen eigenen Kalenderspeicher.

### Wie es funktioniert

```
Dashboard-Plugin  ──▶  SelfMailer  ──▶  Google Kalender
   (Termin)          (deine Konten,       (falls als Ziel
                     ein Token)            gewählt)
```

Das Plugin spricht **nie** direkt mit Google. Es redet nur mit deinem SelfMailer, und
SelfMailer nutzt seine dort hinterlegte Google-Verbindung.

### Voraussetzungen

1. **SelfMailer läuft** (z. B. `http://192.168.1.10:8090`) und ist aktuell
   (Kalender-API mit `?token=` + `/api/v1/calendar/targets`).
2. Ein **persönlicher Token** aus *SelfMailer → Einstellungen → Feeds/Export*
   (derselbe wie beim SelfMailer-Mail-Widget).

---

### Einrichtung — Teil A: Plugin mit SelfMailer verbinden

1. Plugin-Store → **SelfMailer Kalender** installieren → **Strg+F5**.
2. In den Widget-Einstellungen eintragen:
   - **Basis-URL**: deine SelfMailer-Adresse, z. B. `http://192.168.1.10:8090` (ohne Pfad).
   - **Token**: der Feed-Token von oben.
3. **Verbindung testen**. Wenn deine Termine erscheinen → Teil A fertig.

> Nur „Lokal" beim Anlegen wählbar? Dann hat SelfMailer noch **keinen beschreibbaren
> Google-Kalender** — weiter mit Teil B.

---

### Einrichtung — Teil B: Google-Kalender in SelfMailer anbinden (OAuth)

Das passiert **in SelfMailer selbst** (nicht im Dashboard), unter
*Einstellungen → „Google-Kalender verbinden (OAuth)"*. Google erlaubt **kein** einfaches
App-Passwort für Kalender — es braucht OAuth. Einmal einrichten, dann läuft es dauerhaft.

**B1 — In der Google Cloud Console** (`console.cloud.google.com`, kostenlos):

1. Oben ein **Projekt** anlegen/auswählen.
2. **APIs & Dienste → Bibliothek** → **„Google Calendar API"** suchen → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm**:
   - Nutzertyp **Extern** → App-Namen vergeben, deine E-Mail als Kontakt.
   - ⚠️ **Wichtig:** Die App anschließend **„Veröffentlichen / In Produktion"** stellen.
     Bleibt sie im **Test-Modus**, löscht Google die Verbindung **nach genau 7 Tagen**
     (dann geht der Kalender „auf einmal" nicht mehr). In Produktion hält sie dauerhaft.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Typ **Webanwendung**.
   - Unter **Autorisierte Weiterleitungs-URIs** eintragen:
     `https://developers.google.com/oauthplayground`
   - Speichern → **client_id** und **client_secret** notieren.

**B2 — Refresh-Token holen** (`developers.google.com/oauthplayground`):

5. Oben rechts **⚙️ Zahnrad** → Haken bei **„Use your own OAuth credentials"** →
   **client_id** + **client_secret** eintragen.
6. Links im Feld **„Input your own scopes"**: `https://www.googleapis.com/auth/calendar`
   → **Authorize APIs** → mit deinem Google-Konto anmelden/erlauben
   (Warnung „nicht bestätigt" → **Erweitert → Weiter**, ist deine eigene App).
7. **„Exchange authorization code for tokens"** → den **`refresh_token`** kopieren
   (beginnt mit `1//…`).
   - Kontrolle: In der Antwort sollte **kein** `refresh_token_expires_in` stehen
     (wenn doch `604799` = 7 Tage → App steht noch im Test-Modus, siehe B1.3).

**B3 — In SelfMailer eintragen:**

8. *Einstellungen → „Google-Kalender verbinden (OAuth)"*: E-Mail, **client_id**,
   **client_secret**, **refresh_token** → **Verbinden** → **Abgleichen**.
9. Beim Konto sollte **„Letzter Sync … ok"** stehen. Fertig.

---

### Einrichtung — Teil C: Standard-Kalender

Beim Anlegen wählt das Plugin standardmäßig deinen **Hauptkalender (★)** als Ziel.
Anderen Standard möchtest du? → Widget-Einstellungen → **Standard-Ziel-Kalender**
(z. B. „Lokal" oder ein bestimmter Kalender).

### Termine anlegen

**＋ Termin** → Titel, Datum, optional Uhrzeit (leer = ganztägig), Ziel-Kalender.
Anlegen → SelfMailer → (bei Google-Ziel) Google. Der Farbpunkt zeigt den Quell-Kalender.

### Fehlerbehebung

| Symptom | Ursache & Lösung |
|---------|------------------|
| Nur **„Lokal"** wählbar | Kein beschreibbarer Google-Kalender in SelfMailer → Teil B. |
| Konto zeigt **„HTTP 400"** | Google-Token abgelaufen (meist Test-Modus, 7 Tage). App auf **Produktion** stellen (B1.3) + neuen refresh_token holen (B2). |
| **HTTP 403** beim Sync | In der Cloud Console **Google Calendar API aktivieren** (B1.2). |
| Playground-Fehler `redirect_uri_mismatch` | Weiterleitungs-URI `…/oauthplayground` fehlt beim OAuth-Client (B1.4). |
| Termine noch alt/eingefroren | Es sind Reste vom letzten guten Sync; nach dem Fix **„Abgleichen"**. |

### Sicherheit

- Der Token bleibt **serverseitig** (Proxy `/api/plugins/selfmailer-calendar`), kein
  Direktzugriff aus dem Browser; ausgehende Requests laufen über den SSRF-Guard.
- Google-Zugangsdaten (client_secret, refresh_token) speichert **SelfMailer verschlüsselt**;
  das Dashboard kennt sie nie.

---

## English

### Summary

Shows **upcoming SelfMailer events** and creates **new events directly in SelfMailer**.
Pick a Google calendar as target and SelfMailer pushes the event to Google automatically.
SelfMailer stays the single source of truth — the dashboard keeps no calendar store.
The plugin never talks to Google directly; it only talks to your SelfMailer.

### Requirements

1. SelfMailer running (e.g. `http://192.168.1.10:8090`) with the token-capable calendar
   API (`?token=` + `/api/v1/calendar/targets`).
2. A personal **token** from *SelfMailer → Settings → Feeds/Export*.

### Part A — Connect the plugin

Plugin Store → **SelfMailer Calendar** → **Ctrl+F5** → widget settings: **base URL** +
**token** → **Test connection**. If only “Local” is selectable when adding, SelfMailer has
no writable Google calendar yet → do Part B.

### Part B — Connect Google Calendar in SelfMailer (OAuth)

Done **inside SelfMailer** under *Settings → “Connect Google Calendar (OAuth)”*. Google
requires OAuth (no app password for calendars).

1. **Google Cloud Console** (`console.cloud.google.com`): create a project →
   **APIs & Services → Library → enable “Google Calendar API”**.
2. **OAuth consent screen**: user type External, then **Publish the app to “In
   production”**. ⚠️ If left in **Testing**, Google **deletes the token after exactly 7
   days** (calendar “suddenly” stops). Production keeps it permanent.
3. **Credentials → Create OAuth client ID → Web application**. Add authorized redirect URI
   `https://developers.google.com/oauthplayground`. Note **client_id** + **client_secret**.
4. **OAuth Playground** (`developers.google.com/oauthplayground`): gear → “Use your own
   OAuth credentials” → enter client_id/secret. Scope
   `https://www.googleapis.com/auth/calendar` → **Authorize** → **Exchange** → copy the
   **refresh_token** (`1//…`). No `refresh_token_expires_in` in the response = permanent.
5. In SelfMailer: enter email, client_id, client_secret, refresh_token → **Connect** →
   **Sync**. Account should show **“Last sync … ok”**.

### Part C — Default calendar

When adding an event the plugin defaults to your **primary calendar (★)**. Change it in
the widget settings → **Default target calendar**.

### Troubleshooting

- Only **“Local”** selectable → no writable Google calendar in SelfMailer → Part B.
- Account shows **“HTTP 400”** → Google token expired (usually Testing mode / 7 days).
  Publish the app to production + get a fresh refresh_token.
- **HTTP 403** on sync → enable the Google Calendar API.
- `redirect_uri_mismatch` in Playground → add the `…/oauthplayground` redirect URI.
