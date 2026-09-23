# Dreame (Beta)

Dreame-Saugroboter (z. B. **L10s Ultra**) im Dashboard **anzeigen und steuern** —
über die Dreamehome-Cloud, da neuere Dreame-Modelle keine offene lokale API
mehr haben.

> ⚠️ **Beta.** Nutzt die inoffizielle Dreame-Cloud-API (portiert aus der
> Home-Assistant-Integration `Tasshack/dreame-vacuum`). Sie funktioniert nur
> über die Cloud (kein lokaler Zugriff) und kann bei Dreame-App-Updates
> vorübergehend ausfallen.

## Was es zeigt / kann

- **Akku** (mit Lade-Anzeige), **Zustand** (reinigt / fährt zur Basis / lädt /
  pausiert / bereit / Fehler), **Fehlercode**, **Reinigungsfläche & -dauer**.
- Buttons **Start / Pause / zur Basis** (abschaltbar).

## Einrichtung

1. Widget hinzufügen → Einstellungen → **Dreamehome-Konto** eintragen:
   - **E-Mail + Passwort** deines Dreamehome-Kontos.
     Wichtig: ein echtes Passwort-Konto — **nicht** „Mit Google/Apple anmelden".
     Falls du SSO nutzt, setze in der App einmal ein Passwort.
   - **Region:** für Deutschland `de`.
2. „Steuern erlauben" nach Wunsch.

## Sicherheit

- Das Passwort wird **verschlüsselt** gespeichert (AES-256-GCM) und nur für den
  **ersten** Login verwendet; danach nutzt das Plugin einen **Refresh-Token**
  (ebenfalls verschlüsselt im Daten-Volume), das Passwort wird also nicht bei
  jeder Abfrage gesendet.
- Steuern ist nur für angemeldete Dashboard-Nutzer möglich (Host-Login-Gate).
- Bitte nicht zu häufig abfragen (Cloud-Rate-Limit); Standard sind 30 s.

## Technik

- Cloud: `https://<region>.iot.dreame.tech:13267` (Dreames eigene, Alibaba-
  gehostete IoT-Cloud — nicht Xiaomi, nicht Tuya).
- OAuth2 (Passwort- bzw. Refresh-Grant) → `device/listV2` →
  MIOT `get_properties` / `action` über `device/sendCommand`.
- MIOT-IDs (klassische Dreame-Spec): Akku 3/1, Laden 3/2, Status 2/1,
  Fehler 2/2, Zeit 4/2, Fläche 4/3; Aktionen Start 2/1, Pause 2/2, Basis 3/1.

---

# Dreame (English, Beta)

Show and control Dreame robot vacuums (e.g. **L10s Ultra**) via the Dreamehome
cloud (newer Dreame models no longer expose a local API).

**Shows/does:** battery (with charging), status (cleaning/returning/charging/
paused/ready/error), error code, cleaned area & time, and start / pause / dock
buttons (optional).

**Setup:** enter your Dreamehome **email + password** (a real password account,
not Google/Apple SSO) and **region** (`de` for Germany). The password is stored
encrypted and only used for the first login; afterwards a refresh token is used.

**Beta:** unofficial cloud API (ported from `Tasshack/dreame-vacuum`), cloud-only,
may break on Dreame app updates.
