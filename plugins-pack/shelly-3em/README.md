# Shelly 3EM

3-Phasen-Hausmessung mit dem **Shelly Pro 3EM** (oder 3EM) direkt über die
lokale RPC-API — ohne Cloud, ohne API-Key.

## Was es zeigt

- **Gesamtleistung** mit Flussrichtung: **Bezug** (rot ↓) oder **Einspeisung**
  (grün ↑) — ideal fürs Balkonkraftwerk/Nulleinspeisungs-Monitoring.
- **Leistung je Phase** L1/L2/L3 (W, Spannung, Strom).
- Optionaler **kWh-Verlauf**: Bezug/Einspeisung heute, 7 Tage, 30 Tage.

## Einrichtung

1. Shelly 3EM ins WLAN/LAN bringen und die **IP-Adresse** notieren
   (z. B. in der Shelly-App oder im Router).
2. Widget hinzufügen → Einstellungen → Gerät mit **Name + IP** eintragen.
3. Nur falls am Gerät die **Authentifizierung** aktiv ist: Passwort eintragen
   (Benutzer ist bei Shelly immer `admin`). Sonst leer lassen.
4. „Verlauf speichern" an/aus je nach Wunsch.

> **LAN-Zugriff:** Der SelfDashboard-Server ruft das Gerät direkt im Heimnetz
> auf. Dazu muss am Container die Umgebungsvariable
> `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` gesetzt sein, sonst meldet das Widget
> „LAN blockiert (SSRF)".

## Technik

- Live: `EM.GetStatus?id=0` (pro Phase + `total_act_power`, vorzeichenbehaftet).
- Energie: `EMData.GetStatus?id=0` (Bezug/Einspeisung-Zähler in Wh).
- Der Verlauf wird als Zählerstands-Schnappschüsse im Daten-Volume gespeichert;
  kWh je Zeitfenster = Summe positiver Deltas (zählerreset-fest).

---

# Shelly 3EM (English)

Three-phase whole-house measurement with the **Shelly Pro 3EM** (or 3EM) via
the local RPC API — no cloud, no API key.

**Shows:** total power with direction (import red ↓ / export green ↑), per-phase
L1/L2/L3 power/voltage/current, and an optional kWh history (today / 7d / 30d).

**Setup:** add the device by name + IP in settings; set a password only if the
device has authentication enabled (Shelly user is always `admin`). The container
needs `SELFDASHBOARD_ALLOW_PRIVATE_URLS=1` to reach LAN devices.
